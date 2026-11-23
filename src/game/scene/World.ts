import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLORS, TILE, TRACK } from '@/game/core/GameConfig'
import { getMaterials } from '@/game/scene/Materials'
import {
  HURDLE_HEIGHT,
  HURDLE_ROWS,
  HURDLE_THICKNESS,
  ObstacleField,
  PENDULUMS,
  ROLLERS,
  SPIKE_STRIPS,
  SWEEPERS,
} from '@/game/physics/ObstacleField'
import { TileField, TILE_ZONES } from '@/game/physics/TileField'
import { QuizWalls, QUIZ_WALL_COLLIDER_WIDTH, QUIZ_WALL_HEIGHT } from '@/game/scene/QuizWalls'
import { QUIZ_GATES } from '@/game/quiz/QuizSystem'

interface DynamicEntry {
  mesh: THREE.Mesh
  body: RAPIER.RigidBody
}

/** 棋盘贴图一格 = 1.5 m，一张贴图 2×2 格 */
const CHECKER_TILE = 3
/** 主赛道地面在 z 轴上的两端：起点平台末端 +20 → 终点缓冲末端 */
const FLOOR_Z_START = 20
const FLOOR_Z_END = -(TRACK.length + TRACK.runoff)

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
  /** 答题空气墙（视觉 + 开门淡出） */
  readonly quizWalls = new QuizWalls()
  private readonly dynamics: DynamicEntry[] = []
  private readonly spinnerGroups: THREE.Group[] = []
  private readonly rollerGroups: THREE.Group[] = []
  /** 地刺的刺阵网格（底板是静态的，只有刺阵上下动） */
  private readonly spikeMeshes: THREE.Mesh[] = []
  /** 大摆锤的摆动枢轴组 */
  private readonly pendulumGroups: THREE.Group[] = []
  /** 答题墙碰撞体；解开一面就删一个 */
  private readonly quizColliders: Array<RAPIER.Collider | null> = []
  /** 方格桥：状态机（随机消失 / 回弹）+ InstancedMesh + 每格一个 cuboid */
  readonly tiles = new TileField()
  private tileMesh: THREE.InstancedMesh | null = null
  private readonly tileColliders: Array<RAPIER.Collider | null> = []
  private readonly tileDummy = new THREE.Object3D()
  /** 主赛道被方格桥切开后的实心地面段（构造时算一次） */
  private readonly floorSpans: Array<{ zStart: number; zEnd: number }> = computeFloorSpans()

  constructor(private readonly physics: RAPIER.World) {
    this.group.add(
      this.buildFloors(),
      this.buildRails(),
      this.buildHurdles(),
      this.buildPins(),
      this.buildSpikes(),
      this.buildPendulums(),
      this.buildRamp(),
      this.buildFinishGate(),
      this.buildCrown(),
      this.quizWalls.group,
    )
    this.buildTiles()
    this.buildSpinners()
    this.buildColliders()
  }

  /** 物理步之后同步刚体位姿 + 推进障碍与方格桥 */
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
    // 地刺：刺阵整体上下平移，rise=0 时刺尖刚好齐地面
    for (let i = 0; i < this.spikeMeshes.length; i++) {
      this.spikeMeshes[i].position.y = (this.obstacles.spikeRise[i] - 1) * SPIKE_STRIPS[i].height
    }
    // 大摆锤：绕 Z 轴摆，摆角从 ObstacleField 读，判定与画面同一份
    for (let i = 0; i < this.pendulumGroups.length; i++) {
      this.pendulumGroups[i].rotation.z = this.obstacles.pendulumAngles[i]
    }
    this.updateTiles(dt)
    this.quizWalls.update(dt)
  }

  /** 玩家踩到方格：转发给状态机（World 负责后续的碰撞增删与动画） */
  probeTiles(x: number, footY: number, z: number): 'vanish' | 'bounce' | null {
    return this.tiles.probe(x, z, footY)
  }

  /** 重开一局：全部方格重新随机 + 立刻长回来 */
  resetTiles(): void {
    for (let i = 0; i < this.tileColliders.length; i++) {
      const c = this.tileColliders[i]
      if (c) this.physics.removeCollider(c, true)
      this.tileColliders[i] = null
    }
    this.tiles.reset()
    for (let i = 0; i < this.tiles.tiles.length; i++) {
      this.tileColliders[i] = this.createTileCollider(i)
    }
    this.refreshTileColors()
    this.refreshTileMatrices()
  }

  /** 解开一面答题墙：立刻删碰撞（人能从缝里穿过去），画面淡出 */
  openQuizGate(index: number): void {
    const collider = this.quizColliders[index]
    if (collider) {
      this.physics.removeCollider(collider, true)
      this.quizColliders[index] = null
    }
    this.quizWalls.open(index)
  }

  /** 重开一局：墙全部立回去，碰撞体重建 */
  resetQuizGates(): void {
    this.quizWalls.reset()
    for (let i = 0; i < this.quizColliders.length; i++) {
      const old = this.quizColliders[i]
      if (old) this.physics.removeCollider(old, true)
      this.quizColliders[i] = this.createQuizCollider(i)
    }
  }

  dispose(): void {
    this.dynamics.length = 0
    this.spinnerGroups.length = 0
    this.rollerGroups.length = 0
    this.spikeMeshes.length = 0
    this.pendulumGroups.length = 0
    this.tileColliders.length = 0
    this.tileMesh = null
    this.quizWalls.dispose()
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) o.geometry.dispose()
    })
    this.group.clear()
  }

  /**
   * 棋盘平面：UV 用世界坐标算（每 3 m 一张贴图），这样被方格桥切成的几段
   * 拼起来后棋盘纹在接缝处仍然对得上。
   */
  private floorPlane(
    width: number,
    length: number,
    zCenter: number,
    mat: THREE.MeshLambertMaterial,
  ): THREE.Mesh {
    const g = new THREE.PlaneGeometry(width, length, 1, 1)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0.004, zCenter)
    const pos = g.attributes.position as THREE.BufferAttribute
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, pos.getX(i) / CHECKER_TILE, pos.getZ(i) / CHECKER_TILE)
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
   * 地面 = 起点平台 + 主赛道被方格桥切成的几段（每段 1 个平面 + 1 个实体）。
   * 方格桥那几段是真的空洞：方格掉下去以后人就掉进虚空，而不是"看着掉"。
   */
  private buildFloors(): THREE.Group {
    const mats = getMaterials()
    const apronLen = 20

    const group = new THREE.Group()
    group.name = 'Floors'
    group.add(
      this.floorPlane(TRACK.width + 6, apronLen, apronLen / 2, mats.floorStart),
      this.bodyBox(TRACK.width + 6, apronLen, apronLen / 2),
    )
    for (const span of this.floorSpans) {
      const len = span.zStart - span.zEnd
      const center = (span.zStart + span.zEnd) / 2
      group.add(
        this.floorPlane(TRACK.width, len, center, mats.floorMain),
        this.bodyBox(TRACK.width, len, center),
      )
    }
    return group
  }

  /** 两侧粉色护栏（圆角顶），合并成 1 个 draw call */
  private buildRails(): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    const x = TRACK.width / 2 + TRACK.railWidth / 2
    const totalLen = TRACK.length + 20 + TRACK.runoff
    const centerZ = (20 - (TRACK.length + TRACK.runoff)) / 2
    const capR = TRACK.railWidth / 2
    // 方柱只到 0.65，圆顶圆心在 0.75：露出上半圆，最高点正好 1.0，和碰撞屋脊对齐
    const bodyH = TRACK.railHeight - 0.35
    const capY = TRACK.railHeight - capR
    for (const side of [-1, 1]) {
      const body = new THREE.BoxGeometry(TRACK.railWidth, bodyH, totalLen)
      body.translate(side * x, bodyH / 2, centerZ)
      geos.push(body)
      // 顶上一根半圆柱：转 90° 让轴沿 Z，正好接在方柱顶部
      const cap = new THREE.CylinderGeometry(capR, capR, totalLen, 14, 1)
      cap.rotateX(Math.PI / 2)
      cap.translate(side * x, capY, centerZ)
      geos.push(cap)
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

  /**
   * 地刺：静态深色底板（永远可见，提前预警）+ 会上下顶起的刺阵。
   * 底板全部合并成 1 个 draw call，刺阵每块地刺 1 个（要单独动）。
   */
  private buildSpikes(): THREE.Group {
    const group = new THREE.Group()
    group.name = 'SpikeStrips'
    const mats = getMaterials()

    const baseGeos: THREE.BufferGeometry[] = []
    for (const s of SPIKE_STRIPS) {
      const base = new THREE.BoxGeometry(s.width, 0.12, s.length)
      base.translate(0, 0.06, s.z)
      baseGeos.push(base)
    }
    const baseMesh = new THREE.Mesh(mergeGeometries(baseGeos, false), mats.spikeBase)
    baseGeos.forEach((g) => g.dispose())
    baseMesh.matrixAutoUpdate = false
    group.add(baseMesh)

    for (const s of SPIKE_STRIPS) {
      const geos: THREE.BufferGeometry[] = []
      const cols = Math.max(3, Math.floor(s.width / 0.75))
      const rows = Math.max(2, Math.round(s.length / 0.75))
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const cx = -s.width / 2 + ((c + 0.5) * s.width) / cols
          const cz = s.z - s.length / 2 + ((r + 0.5) * s.length) / rows
          const h = s.height * (r === 1 ? 1 : 0.82)
          // 四棱锥：面数少、轮廓硬，一眼看出是刺
          const cone = new THREE.ConeGeometry(0.2, h, 4, 1)
          cone.translate(cx, h / 2, cz)
          geos.push(cone)
        }
      }
      const merged = mergeGeometries(geos, false)
      geos.forEach((g) => g.dispose())
      const mesh = new THREE.Mesh(merged, mats.spike)
      mesh.position.y = -s.height
      this.spikeMeshes.push(mesh)
      group.add(mesh)
    }
    return group
  }

  /**
   * 大摆锤：静态门架（两立柱 + 横梁，1 draw）+ 绕横梁摆动的锤臂与锤头。
   * 摆动枢轴组绕 Z 轴转，锤头位置与 ObstacleField.pendulumHead 完全一致。
   */
  private buildPendulums(): THREE.Group {
    const group = new THREE.Group()
    group.name = 'Pendulums'
    const mats = getMaterials()

    for (const p of PENDULUMS) {
      const gantryGeos: THREE.BufferGeometry[] = []
      const postX = TRACK.width / 2 - 0.6
      for (const side of [-1, 1]) {
        const post = new THREE.BoxGeometry(0.5, p.pivotY + 0.6, 0.5)
        post.translate(p.x + side * postX, (p.pivotY + 0.6) / 2, p.z)
        gantryGeos.push(post)
      }
      const beam = new THREE.BoxGeometry(postX * 2 + 0.5, 0.5, 0.6)
      beam.translate(p.x, p.pivotY, p.z)
      gantryGeos.push(beam)
      const gantry = mergeGeometries(gantryGeos, false)
      gantryGeos.forEach((g) => g.dispose())
      const gantryMesh = new THREE.Mesh(gantry, mats.railDark)
      gantryMesh.matrixAutoUpdate = false
      group.add(gantryMesh)

      const pivot = new THREE.Group()
      pivot.position.set(p.x, p.pivotY, p.z)

      const armGeos: THREE.BufferGeometry[] = []
      const arm = new THREE.CylinderGeometry(0.16, 0.16, p.armLength, 8, 1)
      arm.translate(0, -p.armLength / 2, 0)
      armGeos.push(arm)
      const armMesh = new THREE.Mesh(mergeGeometries(armGeos, false), mats.pendulumArm)
      armGeos.forEach((g) => g.dispose())
      pivot.add(armMesh)

      const head = new THREE.Mesh(new THREE.SphereGeometry(p.headRadius, 12, 10), mats.pendulum)
      head.position.set(0, -p.armLength, 0)
      pivot.add(head)

      // 锤头上的两道箍，让"锤"的轮廓更清楚
      const bandGeos: THREE.BufferGeometry[] = []
      for (const dy of [-0.34, 0.34]) {
        const band = new THREE.CylinderGeometry(p.headRadius * 1.02, p.headRadius * 1.02, 0.16, 12, 1, true)
        band.translate(0, -p.armLength + dy * p.headRadius, 0)
        bandGeos.push(band)
      }
      const bandMesh = new THREE.Mesh(mergeGeometries(bandGeos, false), mats.pendulumArm)
      bandGeos.forEach((g) => g.dispose())
      pivot.add(bandMesh)

      this.pendulumGroups.push(pivot)
      group.add(pivot)
    }
    return group
  }

  /**
   * 方格桥：整场所有方格用 1 个 InstancedMesh（1 draw call）。
   * 颜色用实例色——棋盘青/粉相间，回弹格染暖黄；
   * 碰撞每格一个 cuboid，塌掉就 removeCollider，长回来再 create。
   */
  private buildTiles(): void {
    const count = this.tiles.tiles.length
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mesh = new THREE.InstancedMesh(geo, getMaterials().tile, count)
    mesh.name = 'TileBridges'
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // 每格一件：不做视锥剔除，反正整条赛道都在画面附近
    mesh.frustumCulled = false
    this.group.add(mesh)
    this.tileMesh = mesh
    this.refreshTileColors()
    this.refreshTileMatrices()
    for (let i = 0; i < count; i++) {
      this.tileColliders[i] = this.createTileCollider(i)
    }
  }

  private createTileCollider(index: number): RAPIER.Collider {
    const def = this.tiles.tiles[index]
    const desc = RAPIER.ColliderDesc.cuboid(
      def.width / 2,
      TILE.thickness / 2,
      def.depth / 2,
    ).setTranslation(def.x, -TILE.thickness / 2, def.z)
    return this.physics.createCollider(desc)
  }

  /** 角色重排后（reset）重新上色：消失格是棋盘色（藏起来才吓人），回弹格是暖黄 */
  private refreshTileColors(): void {
    const mesh = this.tileMesh
    if (!mesh) return
    const color = new THREE.Color()
    const cyan = new THREE.Color(COLORS.checkerCyan)
    const pink = new THREE.Color(COLORS.checkerPink)
    const bounce = new THREE.Color(COLORS.tileBounce)
    for (let i = 0; i < this.tiles.tiles.length; i++) {
      const def = this.tiles.tiles[i]
      const role = this.tiles.roleOf(i)
      if (role === 'bounce') color.copy(bounce)
      else color.copy((def.col + def.row) % 2 === 0 ? cyan : pink)
      mesh.setColorAt(i, color)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  /** 每步重写实例矩阵：抖动 / 下坠 / 升起 / 回弹压缩都在这里落地 */
  private refreshTileMatrices(): void {
    const mesh = this.tileMesh
    if (!mesh) return
    const dummy = this.tileDummy
    for (let i = 0; i < this.tiles.tiles.length; i++) {
      const def = this.tiles.tiles[i]
      const vis = this.tiles.visual(i)
      if (!vis.visible) {
        dummy.position.set(def.x, -8, def.z)
        dummy.scale.set(0.001, 0.001, 0.001)
      } else {
        // 回弹压缩：顶面不动，往下压扁
        const h = TILE.thickness * (1 - 0.5 * vis.squash)
        dummy.position.set(def.x + vis.shake, -h / 2 + vis.dropY, def.z)
        dummy.scale.set(def.width * 0.99, h, def.depth * 0.99)
      }
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  /** 推进方格状态机：塌了撤碰撞、长回来补碰撞，再刷一遍矩阵 */
  private updateTiles(dt: number): void {
    const changes = this.tiles.update(dt)
    for (const change of changes) {
      if (change.solid) {
        if (!this.tileColliders[change.index]) {
          this.tileColliders[change.index] = this.createTileCollider(change.index)
        }
      } else {
        const collider = this.tileColliders[change.index]
        if (collider) {
          this.physics.removeCollider(collider, true)
          this.tileColliders[change.index] = null
        }
      }
    }
    this.refreshTileMatrices()
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
    const apron = RAPIER.ColliderDesc.cuboid(
      (TRACK.width + 6) / 2,
      TRACK.groundThickness / 2,
      10,
    ).setTranslation(0, -TRACK.groundThickness / 2, 10)
    this.physics.createCollider(apron)

    // 主赛道实体：按方格桥切段，桥那几段没有碰撞（真的会掉下去）
    for (const span of this.floorSpans) {
      const len = span.zStart - span.zEnd
      const collider = RAPIER.ColliderDesc.cuboid(
        TRACK.width / 2,
        TRACK.groundThickness / 2,
        len / 2,
      ).setTranslation(0, -TRACK.groundThickness / 2, (span.zStart + span.zEnd) / 2)
      this.physics.createCollider(collider)
    }

    const railX = TRACK.width / 2 + TRACK.railWidth / 2
    const railHalfLen = (TRACK.length + 20 + TRACK.runoff) / 2
    const railZ = (20 - (TRACK.length + TRACK.runoff)) / 2
    // 圆角顶：外观是方柱 + 半圆柱，碰撞用「方柱 + 54° 三角形屋脊」。
    // 为什么不用圆柱碰撞：胶囊能吸附在圆柱顶、沿着轴心一路走（实测能走到墙前）；
    // 54° 屋脊大于 maxSlopeClimbAngle(52°)、远大于 minSlopeSlideAngle(32°)，既爬不上也站不住。
    const roofRise = 0.35
    const bodyH = TRACK.railHeight - roofRise
    const roofPts = new Float32Array([
      -TRACK.railWidth / 2, 0, -railHalfLen,
      TRACK.railWidth / 2, 0, -railHalfLen,
      0, roofRise, -railHalfLen,
      -TRACK.railWidth / 2, 0, railHalfLen,
      TRACK.railWidth / 2, 0, railHalfLen,
      0, roofRise, railHalfLen,
    ])
    for (const side of [-1, 1]) {
      const body = RAPIER.ColliderDesc.cuboid(TRACK.railWidth / 2, bodyH / 2, railHalfLen)
        .setTranslation(side * railX, bodyH / 2, railZ)
      this.physics.createCollider(body)
      const roof = RAPIER.ColliderDesc.convexHull(roofPts)
      if (roof) this.physics.createCollider(roof.setTranslation(side * railX, bodyH, railZ))
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

    // 答题空气墙：全宽、4.4 m 高，跳不过去；只有答对才移除
    for (let i = 0; i < QUIZ_GATES.length; i++) {
      this.quizColliders[i] = this.createQuizCollider(i)
    }
  }

  private createQuizCollider(index: number): RAPIER.Collider {
    const z = QUIZ_GATES[index].z
    const desc = RAPIER.ColliderDesc.cuboid(
      QUIZ_WALL_COLLIDER_WIDTH / 2,
      QUIZ_WALL_HEIGHT / 2,
      0.15,
    ).setTranslation(0, QUIZ_WALL_HEIGHT / 2, z)
    return this.physics.createCollider(desc)
  }
}

/** 供调试或后续玩法逻辑读取的配色常量 */
export const TRACK_COLORS = COLORS

/**
 * 主赛道被方格桥切成几段实心地面：从起点平台末端 +20 一路切到终点缓冲末端。
 * 返回的每一段都要建「平面 + 实体 + 碰撞」三件套，桥那几段就真的空着。
 */
function computeFloorSpans(): Array<{ zStart: number; zEnd: number }> {
  const spans: Array<{ zStart: number; zEnd: number }> = []
  let zFrom = FLOOR_Z_START
  // zStart 靠起点（数值更大），先切近的那一段
  const zones = [...TILE_ZONES].sort((a, b) => b.zStart - a.zStart)
  for (const zone of zones) {
    if (zone.zStart < zFrom) spans.push({ zStart: zFrom, zEnd: zone.zStart })
    if (zone.zEnd < zFrom) zFrom = zone.zEnd
  }
  spans.push({ zStart: zFrom, zEnd: FLOOR_Z_END })
  return spans
}
