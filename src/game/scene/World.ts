import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLORS, TRACK } from '@/game/core/GameConfig'
import { getMaterials } from '@/game/scene/Materials'
import {
  HURDLE_HEIGHT,
  HURDLE_ROWS,
  HURDLE_THICKNESS,
  ObstacleField,
  ROLLERS,
  SWEEPERS,
} from '@/game/physics/ObstacleField'

interface DynamicEntry {
  mesh: THREE.Mesh
  body: RAPIER.RigidBody
}

/** 棋盘贴图一格 = 1.5 m，一张贴图 2×2 格 */
const CHECKER_TILE = 3

/** 斜坡参数：坡度 10.6°，跑上去能验证控制器贴坡与落坡 */
const RAMP_ANGLE = (10.6 * Math.PI) / 180
const RAMP_LENGTH = 8
const RAMP_THICKNESS = 0.5
const RAMP_WIDTH = TRACK.width - 2
const RAMP_Z = -66
/** 让坡面上沿的入口正好落在 y = 0，避免出现 0.4 m 台阶 */
const RAMP_Y =
  (RAMP_LENGTH / 2) * Math.sin(RAMP_ANGLE) - (RAMP_THICKNESS / 2) * Math.cos(RAMP_ANGLE)

/**
 * 场景世界：棋盘赛道、粉栏、条纹栏架、旋转扫地杆、滚轴、终点皇冠、起点人群。
 * 视觉与物理分离：视觉合并成少量 draw call，物理只用最简单的 cuboid。
 */
export class GameWorld {
  readonly group = new THREE.Group()
  /** 障碍角度推进 + 命中判定（与视觉同源） */
  readonly obstacles = new ObstacleField()
  private readonly dynamics: DynamicEntry[] = []
  private readonly spinnerGroups: THREE.Group[] = []
  private readonly rollerGroups: THREE.Group[] = []

  constructor(private readonly physics: RAPIER.World) {
    this.group.add(
      this.buildFloors(),
      this.buildRails(),
      this.buildHurdles(),
      this.buildPins(),
      this.buildRamp(),
      this.buildFinishGate(),
      this.buildCrown(),
    )
    this.buildSpinners()
    this.buildColliders()
  }

  /** 物理步之后同步刚体位姿 + 推进障碍角度 */
  update(dt: number): void {
    for (const entry of this.dynamics) {
      const t = entry.body.translation()
      const r = entry.body.rotation()
      entry.mesh.position.set(t.x, t.y, t.z)
      entry.mesh.quaternion.set(r.x, r.y, r.z, r.w)
    }
    // 角度只在 ObstacleField 里推进，视觉直接读数：判定与画面永远同拍
    this.obstacles.update(dt)
    for (let i = 0; i < this.spinnerGroups.length; i++) {
      this.spinnerGroups[i].rotation.y = this.obstacles.sweepAngles[i]
    }
    for (let i = 0; i < this.rollerGroups.length; i++) {
      this.rollerGroups[i].rotation.x = this.obstacles.rollAngles[i]
    }
  }

  dispose(): void {
    this.dynamics.length = 0
    this.spinnerGroups.length = 0
    this.rollerGroups.length = 0
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) o.geometry.dispose()
    })
    this.group.clear()
  }

  /** 棋盘平面：UV 按米数缩放，保证格子始终 1.5 m 见方 */
  private floorPlane(
    width: number,
    length: number,
    zCenter: number,
    mat: THREE.MeshLambertMaterial,
  ): THREE.Mesh {
    const g = new THREE.PlaneGeometry(width, length, 1, 1)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0.004, zCenter)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (width / CHECKER_TILE), uv.getY(i) * (length / CHECKER_TILE))
    }
    uv.needsUpdate = true
    const mesh = new THREE.Mesh(g, mat)
    mesh.matrixAutoUpdate = false
    return mesh
  }

  /** 平台实体：只贡献侧面与底面，顶面由棋盘平面覆盖 */
  private bodyBox(width: number, length: number, zCenter: number): THREE.Mesh {
    const g = new THREE.BoxGeometry(width, TRACK.groundThickness, length)
    g.translate(0, -TRACK.groundThickness / 2, zCenter)
    const mesh = new THREE.Mesh(g, getMaterials().side)
    mesh.matrixAutoUpdate = false
    return mesh
  }

  /**
   * 地面 = 2 个棋盘平面 + 2 个实体，共 4 个 draw call。
   * 刻意不用「BoxGeometry + 6 面材质数组」：那会把每块地面退化成 6 个 draw call。
   */
  private buildFloors(): THREE.Group {
    const mats = getMaterials()
    const apronLen = 20
    // 主体地面一直铺到终点线之后 runoff 米，冲线急停时脚下始终有地
    const trackLen = TRACK.length + apronLen + TRACK.runoff
    const trackCenter = (apronLen - (TRACK.length + TRACK.runoff)) / 2

    const group = new THREE.Group()
    group.name = 'Floors'
    group.add(
      this.floorPlane(TRACK.width + 6, apronLen, apronLen / 2, mats.floorStart),
      this.bodyBox(TRACK.width + 6, apronLen, apronLen / 2),
      this.floorPlane(TRACK.width, trackLen, trackCenter, mats.floorMain),
      this.bodyBox(TRACK.width, trackLen, trackCenter),
    )
    return group
  }

  /** 两侧粉色护栏，合并成 1 个 draw call */
  private buildRails(): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    const x = TRACK.width / 2 + TRACK.railWidth / 2
    const totalLen = TRACK.length + 20 + TRACK.runoff
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(TRACK.railWidth, TRACK.railHeight, totalLen)
      g.translate(side * x, TRACK.railHeight / 2, (20 - (TRACK.length + TRACK.runoff)) / 2)
      geos.push(g)
    }
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, getMaterials().rail)
    mesh.name = 'Rails'
    mesh.matrixAutoUpdate = false
    return mesh
  }

  /** 条纹栏架：每排 2–3 段，交错留缺口，全部合并成 1 个 draw call */
  private buildHurdles(): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    for (const row of HURDLE_ROWS) {
      for (const [cx, w] of row.pieces) {
        const g = new THREE.BoxGeometry(w, HURDLE_HEIGHT, HURDLE_THICKNESS)
        g.translate(cx, HURDLE_HEIGHT / 2, row.z)
        geos.push(g)
      }
    }
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, getMaterials().hurdle)
    mesh.name = 'Hurdles'
    mesh.matrixAutoUpdate = false
    return mesh
  }

  /** 横跨赛道的粉色滚轴（绕自身轴转，顶高 1.7 m 可跳过去） */
  private buildPins(): THREE.Group {
    const group = new THREE.Group()
    group.name = 'RollingPins'
    for (const r of ROLLERS) {
      const holder = new THREE.Group()
      holder.position.set(r.x, r.y, r.z)
      const barrel = new THREE.CylinderGeometry(r.radius, r.radius, r.length, 14, 1)
      barrel.rotateZ(Math.PI / 2)
      holder.add(new THREE.Mesh(barrel, getMaterials().pin))
      this.rollerGroups.push(holder)
      group.add(holder)
    }
    return group
  }

  /** 旋转扫地杆：绕立柱公转，参考图的粉色大摆臂 */
  private buildSpinners(): void {
    for (const s of SWEEPERS) {
      // 立柱 + 摆臂 + 端头合并成一个几何体：每根扫地杆只占 1 个 draw call
      const geos: THREE.BufferGeometry[] = []
      const post = new THREE.CylinderGeometry(0.42, 0.5, 2.0, 10)
      post.translate(0, 1.0, 0)
      geos.push(post)

      const arm = new THREE.CylinderGeometry(0.5, 0.5, s.length, 10, 1)
      arm.rotateZ(Math.PI / 2)
      arm.translate(s.length / 2, 1.05, 0)
      geos.push(arm)

      const cap = new THREE.SphereGeometry(0.55, 10, 8)
      cap.translate(s.length, 1.05, 0)
      geos.push(cap)

      const merged = mergeGeometries(geos, false)
      geos.forEach((g) => g.dispose())

      const pivot = new THREE.Group()
      pivot.position.set(s.x, 0, s.z)
      pivot.add(new THREE.Mesh(merged, getMaterials().sweeper))
      this.group.add(pivot)
      this.spinnerGroups.push(pivot)
    }
  }

  /** 终点拱门：立柱 + 条纹横梁，让冲线后看到的是"门"而不是虚空（2 个 draw call） */
  private buildFinishGate(): THREE.Group {
    const z = -(TRACK.length + 4)
    const group = new THREE.Group()
    group.name = 'FinishGate'

    const pillarGeos: THREE.BufferGeometry[] = []
    // 横梁抬到 10.5 m 以上，让皇冠完整落在门洞里而不是被梁切掉
    const pillarH = 10.5
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.9, pillarH, 0.9)
      g.translate(side * (TRACK.width / 2 - 0.2), pillarH / 2, z)
      pillarGeos.push(g)
    }
    const pillars = mergeGeometries(pillarGeos, false)
    pillarGeos.forEach((g) => g.dispose())
    const pillarMesh = new THREE.Mesh(pillars, getMaterials().rail)
    pillarMesh.matrixAutoUpdate = false
    group.add(pillarMesh)

    const beam = new THREE.BoxGeometry(TRACK.width + 1.4, 1.2, 0.9)
    beam.translate(0, pillarH + 0.6, z)
    const beamMesh = new THREE.Mesh(beam, getMaterials().hurdle)
    beamMesh.matrixAutoUpdate = false
    group.add(beamMesh)

    return group
  }

  /** 终点皇冠，合并成 1 个 draw call */
  private buildCrown(): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    const z = TRACK.finishZ - 1
    const band = new THREE.CylinderGeometry(1.9, 1.9, 1.0, 12, 1, true)
    band.translate(0, 7.0, z)
    geos.push(band)

    const spikes = 8
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2
      const cone = new THREE.ConeGeometry(0.55, 2.4, 6, 1)
      cone.translate(Math.cos(a) * 1.85, 8.6, z + Math.sin(a) * 1.85)
      geos.push(cone)
    }
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, getMaterials().crown)
    mesh.name = 'FinishCrown'
    mesh.matrixAutoUpdate = false
    return mesh
  }

  /** 斜坡：验证角色控制器在上坡/落坡时的表现（坡度约 10.6°） */
  private buildRamp(): THREE.Mesh {
    const geo = new THREE.BoxGeometry(RAMP_WIDTH, RAMP_THICKNESS, RAMP_LENGTH)
    const mesh = new THREE.Mesh(geo, getMaterials().pin)
    mesh.position.set(0, RAMP_Y, RAMP_Z)
    mesh.rotation.x = RAMP_ANGLE
    mesh.name = 'Ramp'
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    return mesh
  }

  /** 物理：起点平台 + 赛道 + 护栏 + 栏架 + 斜坡。扫地杆与滚轴暂不给碰撞（阶段 C 处理） */
  private buildColliders(): void {
    const rampQuat = {
      x: Math.sin(RAMP_ANGLE / 2),
      y: 0,
      z: 0,
      w: Math.cos(RAMP_ANGLE / 2),
    }
    const ramp = RAPIER.ColliderDesc.cuboid(RAMP_WIDTH / 2, RAMP_THICKNESS / 2, RAMP_LENGTH / 2)
      .setTranslation(0, RAMP_Y, RAMP_Z)
      .setRotation(rampQuat)
    this.physics.createCollider(ramp)
    const groundHalfLen = (TRACK.length + 20 + TRACK.runoff) / 2
    const ground = RAPIER.ColliderDesc.cuboid(
      TRACK.width / 2,
      TRACK.groundThickness / 2,
      groundHalfLen,
    ).setTranslation(0, -TRACK.groundThickness / 2, (20 - (TRACK.length + TRACK.runoff)) / 2)
    this.physics.createCollider(ground)

    const apron = RAPIER.ColliderDesc.cuboid(
      (TRACK.width + 6) / 2,
      TRACK.groundThickness / 2,
      10,
    ).setTranslation(0, -TRACK.groundThickness / 2, 10)
    this.physics.createCollider(apron)

    const railX = TRACK.width / 2 + TRACK.railWidth / 2
    const railHalfLen = (TRACK.length + 20 + TRACK.runoff) / 2
    for (const side of [-1, 1]) {
      const rail = RAPIER.ColliderDesc.cuboid(TRACK.railWidth / 2, TRACK.railHeight / 2, railHalfLen)
        .setTranslation(side * railX, TRACK.railHeight / 2, (20 - (TRACK.length + TRACK.runoff)) / 2)
      this.physics.createCollider(rail)
    }

    const rows: Array<{ z: number; pieces: Array<[number, number]> }> = HURDLE_ROWS
    for (const row of rows) {
      for (const [cx, w] of row.pieces) {
        const c = RAPIER.ColliderDesc.cuboid(w / 2, HURDLE_HEIGHT / 2, HURDLE_THICKNESS / 2).setTranslation(
          cx,
          HURDLE_HEIGHT / 2,
          row.z,
        )
        this.physics.createCollider(c)
      }
    }
  }
}

/** 供调试或后续玩法逻辑读取的配色常量 */
export const TRACK_COLORS = COLORS
