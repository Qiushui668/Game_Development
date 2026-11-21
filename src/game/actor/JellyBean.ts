import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLORS } from '@/game/core/GameConfig'
import { clamp, damp } from '@/game/utils/MathUtils'
import type { PlayerState } from '@/game/actor/PlayerController'

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

/** 手臂自然下垂时相对竖直方向的张角（128° = 贴身下垂、略微外撇） */
const ARM_REST = (128 * Math.PI) / 180
const ARM_LEN = 0.62
const ARM_TOP_R = 0.17
const ARM_END_R = 0.125

const SHOULDER_Y = 1.12
const SHOULDER_X = 0.46
const HIP_Y = 0.36
const HIP_X = 0.2

export interface JellyBeanOptions {
  /** 身体主色；联机阶段按玩家分配 */
  color?: number
  scale?: number
}

/**
 * 果冻人：身体/脸/眼睛/双臂/双腿分层建模，四肢挂在独立 pivot 上以便程序化动画。
 * 单角色约 8 个 draw call（身体、脸、眼、左右臂、左右腿、假阴影）。
 * 联机阶段每个玩家一个实例，只用 setColor 换色，不重建几何。
 */
export class JellyBean {
  readonly group = new THREE.Group()
  private readonly torso = new THREE.Group()
  private readonly armL = new THREE.Group()
  private readonly armR = new THREE.Group()
  private readonly legL = new THREE.Group()
  private readonly legR = new THREE.Group()

  private readonly bodyMat: THREE.MeshLambertMaterial
  private readonly faceMat: THREE.MeshLambertMaterial
  private readonly eyeMat: THREE.MeshLambertMaterial
  private readonly shadowMat: THREE.MeshBasicMaterial

  private runPhase = 0
  private breathe = 0
  private squash = 0
  private airBlend = 0

  constructor(opts: JellyBeanOptions = {}) {
    this.bodyMat = new THREE.MeshLambertMaterial({ color: opts.color ?? COLORS.jellyBody })
    // 脸加一点自发光：背光时也能保住奶油色，避免转到阴面就发灰（Lambert 支持 emissive）
    this.faceMat = new THREE.MeshLambertMaterial({
      color: COLORS.jellyFace,
      emissive: new THREE.Color(COLORS.jellyFace),
      emissiveIntensity: 0.3,
    })
    this.eyeMat = new THREE.MeshLambertMaterial({ color: COLORS.jellyEye })
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x1b3a44,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    })

    this.torso.add(this.buildBody(), this.buildFace(), this.buildEyes())
    this.armL.position.set(-SHOULDER_X, SHOULDER_Y, 0)
    this.armR.position.set(SHOULDER_X, SHOULDER_Y, 0)
    this.armL.add(this.buildArm(-1))
    this.armR.add(this.buildArm(1))
    this.legL.position.set(-HIP_X, HIP_Y, 0)
    this.legR.position.set(HIP_X, HIP_Y, 0)
    this.legL.add(this.buildLeg(-1))
    this.legR.add(this.buildLeg(1))

    this.group.name = 'JellyBean'
    this.group.add(this.torso, this.armL, this.armR, this.legL, this.legR, this.buildShadow())
    if (opts.scale !== undefined) this.group.scale.setScalar(opts.scale)
  }

  /** 换色不重建几何，供联机阶段区分玩家 */
  setColor(hex: number): void {
    this.bodyMat.color.setHex(hex)
  }

  /**
   * 程序化动画：跑步摆臂摆腿、腾空收腿抬臂、落地压缩。
   * 由渲染帧调用，dt 用真实帧间隔。
   */
  update(dt: number, s: PlayerState): void {
    const maxSpeed = 7
    const speedRatio = clamp(s.speed / maxSpeed, 0, 1)
    this.runPhase += dt * (2.5 + speedRatio * 10.5)
    this.breathe += dt * 2.1

    // 腾空权重：0 = 地面，1 = 空中
    this.airBlend = damp(this.airBlend, s.grounded ? 0 : 1, 12, dt)
    if (s.justLanded) this.squash = Math.max(this.squash, 0.22)
    this.squash = damp(this.squash, 0, 14, dt)

    const swing = Math.sin(this.runPhase)
    const runAmp = speedRatio * (1 - this.airBlend)
    const armSwing = swing * 0.55 * runAmp
    const legSwing = swing * 0.62 * runAmp
    const raise = this.airBlend * 0.85

    this.legL.rotation.x = legSwing + this.airBlend * 0.42
    this.legR.rotation.x = -legSwing + this.airBlend * 0.28
    this.armL.rotation.x = armSwing
    this.armR.rotation.x = -armSwing
    this.armL.rotation.z = -raise
    this.armR.rotation.z = raise

    // 躯干：跑动前倾 + 上下起伏；待机时轻微呼吸
    const bob = Math.abs(Math.sin(this.runPhase)) * 0.05 * runAmp
    const breathe = Math.sin(this.breathe) * 0.012 * (1 - runAmp)
    this.torso.position.y = bob + breathe
    this.torso.rotation.x = -0.17 * runAmp

    const sy = 1 - this.squash
    const sxz = 1 + this.squash * 0.55
    this.torso.scale.set(sxz, sy, sxz)

    // yaw = 0 表示朝 -Z，模型本身面向 +Z，所以补 π
    this.group.rotation.y = s.yaw + Math.PI
    this.group.position.set(s.x, s.y, s.z)
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

  /** 身体椭球（不含四肢） */
  private buildBody(): THREE.Mesh {
    const body = new THREE.SphereGeometry(0.55, 16, 12)
    xform(body, [0, 0.94, 0], [0, 0, 0], [1.12, 1.24, 1.0])
    const mesh = new THREE.Mesh(body, this.bodyMat)
    mesh.name = 'JellyBody'
    return mesh
  }

  /** 奶油色脸：用微微凸起的椭球而不是平面圆盘，边缘才能自然收进身体轮廓 */
  private buildFace(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(0.36, 18, 14)
    xform(geo, [0, 1.12, 0.26], [0, 0, 0], [1.15, 1.05, 0.92])
    const mesh = new THREE.Mesh(geo, this.faceMat)
    mesh.name = 'JellyFace'
    return mesh
  }

  /** 两颗黑豆眼合并成 1 个网格 */
  private buildEyes(): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    for (const sx of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.075, 10, 8)
      xform(eye, [sx * 0.15, 1.13, 0.565], [0, 0, 0], [1, 1.35, 0.5])
      geos.push(eye)
    }
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, this.eyeMat)
    mesh.name = 'JellyEyes'
    return mesh
  }

  /** 单臂（含掌与手指），几何以肩关节为原点，便于绕 pivot 摆动 */
  private buildArm(side: number): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = []
    const angle = ARM_REST * side
    const dir = new THREE.Vector3(Math.sin(angle), Math.cos(angle), 0)

    const arm = new THREE.CylinderGeometry(ARM_END_R, ARM_TOP_R, ARM_LEN, 10, 1)
    xform(arm, [(dir.x * ARM_LEN) / 2, (dir.y * ARM_LEN) / 2, 0], [0, 0, -angle])
    geos.push(arm)

    const hand = new THREE.Vector3(dir.x * ARM_LEN, dir.y * ARM_LEN, 0)
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
      xform(finger, [hand.x + dir.x * 0.14, hand.y + dir.y * 0.14 + dy, hand.z + dz])
      geos.push(finger)
    }

    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(merged, this.bodyMat)
    mesh.name = side < 0 ? 'JellyArmL' : 'JellyArmR'
    return mesh
  }

  /** 单腿（一只脚），几何以髋关节为原点 */
  private buildLeg(side: number): THREE.Mesh {
    const foot = new THREE.SphereGeometry(0.2, 10, 8)
    xform(foot, [0, -0.18, 0.1], [0, 0, 0], [1.05, 0.9, 1.2])
    const mesh = new THREE.Mesh(foot, this.bodyMat)
    mesh.name = side < 0 ? 'JellyLegL' : 'JellyLegR'
    return mesh
  }

  /** 假接触阴影：不随躯干起伏，始终贴地 */
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
