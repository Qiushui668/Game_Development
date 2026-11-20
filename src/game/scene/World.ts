import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLORS, CROWD_COLORS, TRACK } from '@/game/core/GameConfig'
import { getMaterials } from '@/game/scene/Materials'

interface DynamicEntry {
  mesh: THREE.Mesh
  body: RAPIER.RigidBody
}

interface Spinner {
  group: THREE.Group
  speed: number
  angle: number
}

/** 棋盘贴图一格 = 1.5 m，一张贴图 2×2 格 */
const CHECKER_TILE = 3

/** 栏架排布：每排若干段，交错留缺口。视觉与碰撞共用这份数据 */
const HURDLE_ROWS: Array<{ z: number; pieces: Array<[number, number]> }> = [
  { z: -34, pieces: [[-6.5, 5], [3.5, 4]] },
  { z: -58, pieces: [[-4.5, 4], [5.5, 5]] },
  { z: -82, pieces: [[-7.5, 3], [0, 6], [7.5, 3]] },
  { z: -106, pieces: [[-5.5, 5], [4.5, 4]] },
  { z: -130, pieces: [[-5, 4], [3, 3], [7.5, 3]] },
  { z: -154, pieces: [[-3.5, 5], [5.5, 4]] },
]

const HURDLE_HEIGHT = 2.2
const HURDLE_THICKNESS = 0.8

/**
 * 场景世界：棋盘赛道、粉栏、条纹栏架、旋转扫地杆、滚轴、终点皇冠、起点人群。
 * 视觉与物理分离：视觉合并成少量 draw call，物理只用最简单的 cuboid。
 */
export class GameWorld {
  readonly group = new THREE.Group()
  private readonly dynamics: DynamicEntry[] = []
  private readonly spinners: Spinner[] = []
  private readonly rollers: Array<{ group: THREE.Group; speed: number }> = []

  constructor(private readonly physics: RAPIER.World) {
    this.group.add(
      this.buildFloors(),
      this.buildRails(),
      this.buildHurdles(),
      this.buildPins(),
      this.buildCrown(),
      this.buildCrowd(),
      this.spawnTestCube(),
    )
    this.buildSpinners()
    this.buildColliders()
  }

  /** 物理步之后同步刚体位姿 + 推进装饰件动画 */
  update(dt: number): void {
    for (const entry of this.dynamics) {
      const t = entry.body.translation()
      const r = entry.body.rotation()
      entry.mesh.position.set(t.x, t.y, t.z)
      entry.mesh.quaternion.set(r.x, r.y, r.z, r.w)
    }
    for (const s of this.spinners) {
      s.angle = (s.angle + s.speed * dt) % (Math.PI * 2)
      s.group.rotation.y = s.angle
    }
    for (const r of this.rollers) {
      r.group.rotation.x = (r.group.rotation.x + r.speed * dt) % (Math.PI * 2)
    }
  }

  dispose(): void {
    this.dynamics.length = 0
    this.spinners.length = 0
    this.rollers.length = 0
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
    const trackLen = TRACK.length + apronLen
    const trackCenter = -(TRACK.length - apronLen) / 2

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
    const totalLen = TRACK.length + 20
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(TRACK.railWidth, TRACK.railHeight, totalLen)
      g.translate(side * x, TRACK.railHeight / 2, -(TRACK.length - 20) / 2)
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

  /** 横在赛道上的粉色滚轴（视觉滚动，碰撞留到阶段 C） */
  private buildPins(): THREE.Group {
    const group = new THREE.Group()
    group.name = 'RollingPins'
    const spots: Array<[number, number, number]> = [
      [-46, 8, 2.2],
      [-98, 6.5, 1.4],
      [-142, 8, 1.8],
    ]
    for (const [z, length, speed] of spots) {
      const holder = new THREE.Group()
      holder.position.set(0, 1.25, z)
      const barrel = new THREE.CylinderGeometry(1.15, 1.15, length, 12, 1)
      barrel.rotateZ(Math.PI / 2)
      const mesh = new THREE.Mesh(barrel, getMaterials().pin)
      holder.add(mesh)
      this.rollers.push({ group: holder, speed })
      group.add(holder)
    }
    return group
  }

  /** 旋转扫地杆：绕立柱公转，参考图的粉色大摆臂 */
  private buildSpinners(): void {
    const spots: Array<[number, number, number, number]> = [
      [-22, -5.5, 6.2, 1.35],
      [-70, 5.5, 6.6, -1.15],
      [-118, -5.5, 6.0, 1.5],
      [-166, 5.0, 5.4, -1.55],
    ]

    spots.forEach(([z, x, len, speed], i) => {
      // 立柱 + 摆臂 + 端头合并成一个几何体：每根扫地杆只占 1 个 draw call
      const geos: THREE.BufferGeometry[] = []
      const post = new THREE.CylinderGeometry(0.42, 0.5, 2.0, 10)
      post.translate(0, 1.0, 0)
      geos.push(post)

      const arm = new THREE.CylinderGeometry(0.5, 0.5, len, 10, 1)
      arm.rotateZ(Math.PI / 2)
      arm.translate(len / 2, 1.05, 0)
      geos.push(arm)

      const cap = new THREE.SphereGeometry(0.55, 10, 8)
      cap.translate(len, 1.05, 0)
      geos.push(cap)

      const merged = mergeGeometries(geos, false)
      geos.forEach((g) => g.dispose())

      const pivot = new THREE.Group()
      pivot.position.set(x, 0, z)
      pivot.add(new THREE.Mesh(merged, getMaterials().sweeper))
      this.group.add(pivot)
      this.spinners.push({ group: pivot, speed, angle: i * 1.1 })
    })
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

  /** 起点人群：InstancedMesh 一次 draw，视觉糖豆人 */
  private buildCrowd(): THREE.InstancedMesh {
    const body = new THREE.SphereGeometry(0.52, 8, 6)
    body.scale(1, 1.18, 0.92)
    const leftFoot = new THREE.SphereGeometry(0.2, 6, 5)
    leftFoot.translate(-0.22, -0.62, 0.14)
    const rightFoot = new THREE.SphereGeometry(0.2, 6, 5)
    rightFoot.translate(0.22, -0.62, 0.14)

    const merged = mergeGeometries([body, leftFoot, rightFoot], false)
    body.dispose()
    leftFoot.dispose()
    rightFoot.dispose()

    const count = 54
    const mesh = new THREE.InstancedMesh(merged, getMaterials().crowd, count)
    mesh.name = 'Crowd'
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)

    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    let seed = 1337
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    for (let i = 0; i < count; i++) {
      const x = (rand() - 0.5) * (TRACK.width + 3)
      const z = 13.5 - rand() * 11
      const scale = 0.85 + rand() * 0.5
      dummy.position.set(x, 0.55 * scale, z)
      dummy.rotation.set(0, rand() * Math.PI * 2, 0)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      color.set(CROWD_COLORS[i % CROWD_COLORS.length])
      mesh.setColorAt(i, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    return mesh
  }

  /** 物理：起点平台 + 赛道 + 护栏 + 栏架。扫地杆与滚轴暂不给碰撞（阶段 C 处理） */
  private buildColliders(): void {
    const groundHalfLen = (TRACK.length + 20) / 2
    const ground = RAPIER.ColliderDesc.cuboid(
      TRACK.width / 2,
      TRACK.groundThickness / 2,
      groundHalfLen,
    ).setTranslation(0, -TRACK.groundThickness / 2, -(TRACK.length - 20) / 2)
    this.physics.createCollider(ground)

    const apron = RAPIER.ColliderDesc.cuboid(
      (TRACK.width + 6) / 2,
      TRACK.groundThickness / 2,
      10,
    ).setTranslation(0, -TRACK.groundThickness / 2, 10)
    this.physics.createCollider(apron)

    const railX = TRACK.width / 2 + TRACK.railWidth / 2
    const railHalfLen = (TRACK.length + 20) / 2
    for (const side of [-1, 1]) {
      const rail = RAPIER.ColliderDesc.cuboid(TRACK.railWidth / 2, TRACK.railHeight / 2, railHalfLen)
        .setTranslation(side * railX, TRACK.railHeight / 2, -(TRACK.length - 20) / 2)
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

  /** M1 测试物体：一颗会落地的粉色方块，用来验证重力与物理-视觉同步 */
  private spawnTestCube(): THREE.Mesh {
    const size = 1.4
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), getMaterials().pin)
    mesh.name = 'TestCube'
    this.group.add(mesh)

    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 7, -14),
    )
    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2), body)
    this.dynamics.push({ mesh, body })
    return mesh
  }
}

/** 供调试或后续玩法逻辑读取的配色常量 */
export const TRACK_COLORS = COLORS
