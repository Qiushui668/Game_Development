import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLORS } from '@/game/core/GameConfig'

type Vec3 = [number, number, number]

function xform(
  geo: THREE.BufferGeometry,
  pos: Vec3 = [0, 0, 0],
  rot: Vec3 = [0, 0, 0],
  scale: Vec3 = [1, 1, 1],
): THREE.BufferGeometry {
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
  m.compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]),
    q,
    new THREE.Vector3(scale[0], scale[1], scale[2]),
  )
  geo.applyMatrix4(m)
  return geo
}

/** 手臂相对竖直方向的张角，参考图约 55° */
const ARM_TILT = (55 * Math.PI) / 180
const ARM_LEN = 0.75
const ARM_TOP_R = 0.17
const ARM_END_R = 0.125

export interface JellyBeanOptions {
  /** 身体主色；联机阶段按玩家分配 */
  color?: number
  scale?: number
}

/**
 * 果冻人：纯程序几何，不依赖外部模型文件。
 * 三个材质分组合并后只占 3 个 draw call（身体 / 脸 / 眼睛），外加 1 个假接触阴影。
 * 联机阶段只需给每个玩家一个实例并调用 setColor，几何不重建。
 */
export class JellyBean {
  readonly group = new THREE.Group()
  private readonly bodyMat: THREE.MeshLambertMaterial
  private readonly faceMat: THREE.MeshLambertMaterial
  private readonly eyeMat: THREE.MeshLambertMaterial
  private readonly shadowMat: THREE.MeshBasicMaterial

  constructor(opts: JellyBeanOptions = {}) {
    this.bodyMat = new THREE.MeshLambertMaterial({ color: opts.color ?? COLORS.jellyBody })
    this.faceMat = new THREE.MeshLambertMaterial({ color: COLORS.jellyFace })
    this.eyeMat = new THREE.MeshLambertMaterial({ color: COLORS.jellyEye })
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x1b3a44,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    })

    this.group.name = 'JellyBean'
    this.group.add(this.buildBody(), this.buildFace(), this.buildEyes(), this.buildShadow())
    if (opts.scale !== undefined) this.group.scale.setScalar(opts.scale)
  }

  /** 换色不重建几何，供联机阶段区分玩家 */
  setColor(hex: number): void {
    this.bodyMat.color.setHex(hex)
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    this.group.clear()
    this.bodyMat.dispose()
    this.faceMat.dispose()
    this.eyeMat.dispose()
    this.shadowMat.dispose()
  }

  /** 身体 + 双脚 + 双臂 + 手套，合并成一个网格 */
  private buildBody(): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    const body = new THREE.SphereGeometry(0.55, 16, 12)
    xform(body, [0, 0.94, 0], [0, 0, 0], [1.12, 1.24, 1.0])
    geos.push(body)

    for (const sx of [-1, 1]) {
      const foot = new THREE.SphereGeometry(0.2, 10, 8)
      xform(foot, [sx * 0.2, 0.15, 0.1], [0, 0, 0], [1.05, 0.9, 1.2])
      geos.push(foot)
    }

    for (const sx of [-1, 1]) {
      const dir = new THREE.Vector3(sx * Math.sin(ARM_TILT), Math.cos(ARM_TILT), 0)
      const shoulder = new THREE.Vector3(sx * 0.46, 1.02, 0)

      const arm = new THREE.CylinderGeometry(ARM_END_R, ARM_TOP_R, ARM_LEN, 10, 1)
      xform(arm, [
        shoulder.x + (dir.x * ARM_LEN) / 2,
        shoulder.y + (dir.y * ARM_LEN) / 2,
        0,
      ], [0, 0, -sx * ARM_TILT])
      geos.push(arm)

      const hand = new THREE.Vector3(
        shoulder.x + dir.x * ARM_LEN,
        shoulder.y + dir.y * ARM_LEN,
        0,
      )
      const palm = new THREE.SphereGeometry(0.17, 10, 8)
      xform(palm, [hand.x, hand.y, hand.z], [0, 0, 0], [1.05, 1.0, 0.95])
      geos.push(palm)

      const thumb = new THREE.SphereGeometry(0.065, 8, 6)
      xform(thumb, [hand.x - dir.x * 0.02, hand.y - 0.13, hand.z + 0.03])
      geos.push(thumb)

      const fingers: Array<[number, number]> = [
        [0.06, 0.02],
        [0, 0.08],
        [-0.06, 0.02],
      ]
      for (const [dy, dz] of fingers) {
        const finger = new THREE.SphereGeometry(0.055, 8, 6)
        xform(finger, [
          hand.x + dir.x * 0.14,
          hand.y + dir.y * 0.14 + dy,
          hand.z + dz,
        ])
        geos.push(finger)
      }
    }

    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, this.bodyMat)
    mesh.name = 'JellyBody'
    return mesh
  }

  /** 奶油色椭圆脸 */
  private buildFace(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(0.34, 16, 12)
    xform(geo, [0, 1.26, 0.44], [0, 0, 0], [1.02, 1.06, 0.28])
    const mesh = new THREE.Mesh(geo, this.faceMat)
    mesh.name = 'JellyFace'
    return mesh
  }

  /** 两颗黑豆眼，合并成 1 个网格 */
  private buildEyes(): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    for (const sx of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.07, 8, 6)
      xform(eye, [sx * 0.135, 1.26, 0.545], [0, 0, 0], [1, 1.4, 0.35])
      geos.push(eye)
    }
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, this.eyeMat)
    mesh.name = 'JellyEyes'
    return mesh
  }

  /** 假接触阴影：无实时阴影时的落地感补偿 */
  private buildShadow(): THREE.Mesh {
    const geo = new THREE.CircleGeometry(0.72, 20)
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, 0.008, 0.04)
    const mesh = new THREE.Mesh(geo, this.shadowMat)
    mesh.name = 'JellyShadow'
    mesh.renderOrder = 1
    return mesh
  }
}
