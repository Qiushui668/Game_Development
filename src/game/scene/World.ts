import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TRACK } from '@/game/core/GameConfig'
import { getMaterials } from '@/game/scene/Materials'

interface DynamicEntry {
  mesh: THREE.Mesh
  body: RAPIER.RigidBody
}

/**
 * 场景世界：赛道、护栏、终点拱门、远山装饰与 M1 测试物体。
 * 视觉与物理分离：视觉合并为少量 draw call，物理用最简单的 cuboid 拼。
 */
export class GameWorld {
  readonly group = new THREE.Group()
  private readonly dynamics: DynamicEntry[] = []

  constructor(private readonly physics: RAPIER.World) {
    this.group.add(this.buildTrack(), this.buildRails(), this.buildFinishArch())
    this.buildColliders()
    this.spawnTestCube()
  }

  /** 物理步之后把刚体位姿同步到视觉 */
  sync(): void {
    for (const entry of this.dynamics) {
      const t = entry.body.translation()
      const r = entry.body.rotation()
      entry.mesh.position.set(t.x, t.y, t.z)
      entry.mesh.quaternion.set(r.x, r.y, r.z, r.w)
    }
  }

  dispose(): void {
    this.dynamics.length = 0
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    this.group.clear()
  }

  private slab(width: number, length: number, zCenter: number): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(width, TRACK.groundThickness, length)
    g.translate(0, -TRACK.groundThickness / 2, zCenter)
    return g
  }

  private buildTrack(): THREE.Group {
    const mats = getMaterials()
    const group = new THREE.Group()

    const startLen = TRACK.startPlatformLength
    const finishLen = TRACK.finishPlatformLength
    const mainLen = TRACK.length - startLen - finishLen

    const start = this.slab(TRACK.width, startLen, -startLen / 2)
    const main = this.slab(TRACK.width, mainLen, -(startLen + mainLen / 2))
    const finish = this.slab(TRACK.width, finishLen, -(TRACK.length - finishLen / 2))

    group.add(
      new THREE.Mesh(start, mats.start),
      new THREE.Mesh(main, mats.track),
      new THREE.Mesh(finish, mats.finish),
    )
    group.name = 'RaceTrack'
    for (const m of group.children) m.matrixAutoUpdate = false
    return group
  }

  private buildRails(): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    const x = TRACK.width / 2 + TRACK.railWidth / 2
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(TRACK.railWidth, TRACK.railHeight, TRACK.length + 1)
      g.translate(side * x, TRACK.railHeight / 2, -TRACK.length / 2)
      geos.push(g)
    }
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, getMaterials().rail)
    mesh.name = 'Rails'
    mesh.matrixAutoUpdate = false
    return mesh
  }

  private buildFinishArch(): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    const z = TRACK.finishZ
    for (const side of [-1, 1]) {
      const pillar = new THREE.BoxGeometry(0.7, 6, 0.7)
      pillar.translate(side * 5.3, 3, z)
      geos.push(pillar)
    }
    const bar = new THREE.BoxGeometry(11.6, 0.9, 0.9)
    bar.translate(0, 6.4, z)
    geos.push(bar)
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, getMaterials().obstacle)
    mesh.name = 'FinishArch'
    mesh.matrixAutoUpdate = false
    return mesh
  }

  /** 物理：整条赛道 1 个地面 + 2 条护栏 */
  private buildColliders(): void {
    const halfLen = (TRACK.length + 1) / 2
    const ground = RAPIER.ColliderDesc.cuboid(TRACK.width / 2, TRACK.groundThickness / 2, halfLen)
      .setTranslation(0, -TRACK.groundThickness / 2, -TRACK.length / 2)
    this.physics.createCollider(ground)

    const railX = TRACK.width / 2 + TRACK.railWidth / 2
    for (const side of [-1, 1]) {
      const rail = RAPIER.ColliderDesc.cuboid(TRACK.railWidth / 2, TRACK.railHeight / 2, halfLen)
        .setTranslation(side * railX, TRACK.railHeight / 2, -TRACK.length / 2)
      this.physics.createCollider(rail)
    }
  }

  /** M1 测试物体：一颗会落地的粉色方块，用来验证重力与物理-视觉同步 */
  private spawnTestCube(): void {
    const size = 1.4
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), getMaterials().obstacle)
    mesh.name = 'TestCube'
    this.group.add(mesh)

    const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 7, -14))
    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2), body)
    this.dynamics.push({ mesh, body })
  }
}
