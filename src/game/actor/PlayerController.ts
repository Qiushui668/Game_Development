import RAPIER from '@dimforge/rapier3d-compat'
import { OBSTACLE, PHYSICS, PLAYER } from '@/game/core/GameConfig'
import { clamp, damp } from '@/game/utils/MathUtils'

export interface MoveIntent {
  /** 本地坐标：x 右为正，y 前为正，范围 -1..1 */
  x: number
  y: number
  sprint: boolean
  jump: boolean
  /** 相机偏航角，决定"前"在世界里指向哪 */
  yaw: number
}

export interface PlayerState {
  /** 脚底位置 */
  x: number
  y: number
  z: number
  /** 朝向（弧度，0 = 朝 -Z） */
  yaw: number
  speed: number
  verticalSpeed: number
  grounded: boolean
  justLanded: boolean
  /** 被障碍击中后的硬直中（输入无效） */
  stunned: boolean
}

export interface Knockback {
  dirX: number
  dirZ: number
  speed: number
  hop: number
}

function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current
  if (Math.abs(diff) <= maxDelta) return target
  return current + Math.sign(diff) * maxDelta
}

function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * 角色控制器：Rapier KinematicCharacterController + 胶囊体。
 * 物理参数全部来自 GameConfig.PLAYER / PHYSICS，改手感只改常量。
 * 本文件只做运动学，不碰渲染。
 */
export class PlayerController {
  private readonly rigid: RAPIER.RigidBody
  private readonly collider: RAPIER.Collider
  private readonly character: RAPIER.KinematicCharacterController
  /** 胶囊中心到脚底的距离 */
  private readonly centerOffset: number

  private readonly spawn: { x: number; y: number; z: number }

  private vx = 0
  private vz = 0
  private vy = 0
  private grounded = true
  private wasGrounded = true
  private coyote = 0
  private jumpBuffer = 0
  private feetY: number
  private facing: number
  /** 硬直剩余时间 */
  private stunT = 0
  /** 重复命中间隔 */
  private hitCooldownT = 0

  constructor(physics: RAPIER.World, spawn: { x: number; y: number; z: number }) {
    this.spawn = { ...spawn }
    const halfHeight = Math.max(0.05, (PLAYER.height - PLAYER.radius * 2) / 2)
    this.centerOffset = PLAYER.radius + halfHeight
    this.feetY = spawn.y
    this.facing = 0

    this.rigid = physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        spawn.y + this.centerOffset,
        spawn.z,
      ),
    )
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, PLAYER.radius),
      this.rigid,
    )

    this.character = physics.createCharacterController(0.02)
    this.character.setUp({ x: 0, y: 1, z: 0 })
    // 台阶自动上台（栏架边缘、赛道边缘），下坡/小落差自动贴地
    this.character.enableAutostep(0.4, 0.2, true)
    this.character.enableSnapToGround(0.45)
    this.character.setMaxSlopeClimbAngle((52 * Math.PI) / 180)
    this.character.setMinSlopeSlideAngle((32 * Math.PI) / 180)
    this.character.setApplyImpulsesToDynamicBodies(true)
  }

  /** 固定步第一步：算期望位移并提交给运动学刚体。必须在 physics.step() 之前调用 */
  prepare(h: number, intent: MoveIntent): void {
    this.hitCooldownT = Math.max(0, this.hitCooldownT - h)
    const stunned = this.stunT > 0
    if (stunned) this.stunT = Math.max(0, this.stunT - h)

    // 跳跃输入缓冲：落地前一瞬间按下也能起跳；硬直期间不接受
    if (intent.jump && !stunned) this.jumpBuffer = PLAYER.jumpBuffer
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - h)

    const rawLen = Math.hypot(intent.x, intent.y)
    const localX = rawLen > 1 ? intent.x / rawLen : intent.x
    const localY = rawLen > 1 ? intent.y / rawLen : intent.y

    // 相机 yaw = 0 时背影朝 +Z、前进朝 -Z
    const forwardX = -Math.sin(intent.yaw)
    const forwardZ = -Math.cos(intent.yaw)
    const rightX = Math.cos(intent.yaw)
    const rightZ = -Math.sin(intent.yaw)

    if (stunned) {
      // 硬直：输入无效，击退速度按指数自然衰减，让人被"打飞"而非瞬停
      const decay = Math.exp(-2.4 * h)
      this.vx *= decay
      this.vz *= decay
    } else {
      const targetSpeed = intent.sprint ? PLAYER.sprintSpeed : PLAYER.maxSpeed
      const targetVx = (forwardX * localY + rightX * localX) * targetSpeed
      const targetVz = (forwardZ * localY + rightZ * localX) * targetSpeed

      const rate = rawLen > 0.01 ? PLAYER.accel : PLAYER.decel
      const effectiveRate = this.grounded ? rate : rate * PLAYER.airControl
      this.vx = approach(this.vx, targetVx, effectiveRate * h)
      this.vz = approach(this.vz, targetVz, effectiveRate * h)
    }

    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vy = PLAYER.jumpVelocity
      this.grounded = false
      this.coyote = 0
      this.jumpBuffer = 0
    }

    if (!this.grounded) {
      const mult = this.vy < 0 ? PHYSICS.fallGravityMultiplier : 1
      this.vy = Math.max(PLAYER.maxFallSpeed, this.vy + PHYSICS.gravityY * mult * h)
    }

    const desired = { x: this.vx * h, y: this.vy * h, z: this.vz * h }
    this.character.computeColliderMovement(this.collider, desired)
    const moved = this.character.computedMovement()
    const t = this.rigid.translation()
    this.rigid.setNextKinematicTranslation({
      x: t.x + moved.x,
      y: t.y + moved.y,
      z: t.z + moved.z,
    })

    this.wasGrounded = this.grounded
    this.grounded = this.character.computedGrounded()
  }

  /** 固定步第二步：physics.step() 之后读回真实位置并结算状态 */
  sync(h: number): void {
    const t = this.rigid.translation()
    const speed = Math.hypot(this.vx, this.vz)
    this.feetY = t.y - this.centerOffset

    if (this.grounded) {
      if (this.vy < 0) this.vy = 0
      this.coyote = PLAYER.coyoteTime
    } else {
      this.coyote = Math.max(0, this.coyote - h)
    }

    // 朝向跟随水平速度；静止时保持原朝向
    if (speed > 0.6) {
      const target = Math.atan2(-this.vx, -this.vz)
      this.facing = this.facing + angleDelta(this.facing, target) * (1 - Math.exp(-12 * h))
    }

    if (this.feetY < PLAYER.fallRespawnY) this.respawn()
  }

  /** 供渲染层读取的不可变快照 */
  read(): PlayerState {
    const t = this.rigid.translation()
    return {
      x: t.x,
      y: this.feetY,
      z: t.z,
      yaw: this.facing,
      speed: Math.hypot(this.vx, this.vz),
      verticalSpeed: this.vy,
      grounded: this.grounded,
      justLanded: this.grounded && !this.wasGrounded,
      stunned: this.stunT > 0,
    }
  }

  /**
   * 被玩家轻击推一下：只有一点点位移和一个短上抛，不进硬直。
   * 第三下累计倒地时才由 applyStun 接管（那里会把横速清零）。
   */
  applyFlinch(dirX: number, dirZ: number, speed: number): void {
    this.vx = dirX * speed
    this.vz = dirZ * speed
    this.vy = Math.max(this.vy, 0.45)
    this.grounded = false
  }


  applyKnockback(kb: Knockback): boolean {
    if (this.hitCooldownT > 0) return false
    this.vx = kb.dirX * kb.speed
    this.vz = kb.dirZ * kb.speed
    this.vy = Math.max(this.vy, kb.hop)
    this.grounded = false
    this.coyote = 0
    this.jumpBuffer = 0
    this.stunT = OBSTACLE.stunSeconds
    this.hitCooldownT = OBSTACLE.hitCooldown
    return true
  }

  /** 被玩家击倒：进入眩晕、清零横速（不倒地位移，原地被打倒）。返回是否真的生效 */
  applyStun(seconds: number): boolean {
    if (seconds <= 0) return false
    this.stunT = Math.max(this.stunT, seconds)
    this.vx = 0
    this.vz = 0
    this.grounded = false
    this.jumpBuffer = 0
    return true
  }

  /** 圆角护栏顶站不住：取消支撑并给一个朝赛道内的横速，让角色滑回赛道 */
  slipOffRail(inwardDir: number, speed = 3.2): void {
    this.vx = inwardDir * speed
    this.grounded = false
    this.coyote = 0
  }

  get isStunned(): boolean {
    return this.stunT > 0
  }

  /** 冲线后急停：不清垂直速度，让重力把人落到终点平台上，横速直接归零防止冲出赛道 */
  halt(): void {
    this.vx = 0
    this.vz = 0
    this.stunT = 0
    this.hitCooldownT = 0
    this.jumpBuffer = 0
  }

  respawn(): void {
    this.teleport(this.spawn.x, this.spawn.y, this.spawn.z)
  }

  /** 直接把脚底放到指定位置（复活 / 自动化验收用） */
  teleport(x: number, y: number, z: number): void {
    this.rigid.setTranslation({ x, y: y + this.centerOffset, z }, true)
    this.vx = 0
    this.vz = 0
    this.vy = 0
    this.feetY = y
    this.grounded = false
    this.wasGrounded = false
    this.coyote = 0
    this.stunT = 0
    this.hitCooldownT = 0
  }

  /** 相机平滑用：把朝向角约束到 [-π, π] */
  get facingYaw(): number {
    return clamp(this.facing, -Math.PI, Math.PI)
  }

  get lateralSpeed(): number {
    return Math.hypot(this.vx, this.vz)
  }

  /** 目前没用到但保留：让角色朝向缓动到指定角度 */
  lookTowards(yaw: number, dt: number): void {
    this.facing = damp(this.facing, yaw, 6, dt)
  }
}
