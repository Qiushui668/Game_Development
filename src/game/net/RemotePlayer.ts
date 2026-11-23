/**
 * 远程玩家：一个果冻人 + 位置插值缓冲。
 * 收到的是 20 Hz 快照，渲染时按 ~100 ms 延迟插值，避免 20 Hz 台阶感。
 * 只做表现，不参与物理 —— 远端位置完全由网络驱动（客户端权威）。
 */
import * as THREE from 'three'
import { JellyBean } from '@/game/actor/JellyBean'
import { NameTag } from '@/game/actor/NameTag'
import { PLAYER } from '@/game/core/GameConfig'
import type { PlayerState } from '@/game/actor/PlayerController'
import type { PlayerStatePayload } from '@/types/network'
import type { AttackKind } from '@/game/combat/AttackSystem'

/** 插值延迟（秒）：比 20 Hz 的发送间隔（50 ms）大，保证总有前后两帧可插 */
const INTERP_DELAY = 0.1
/** 缓冲上限：3 s 的包量，超了丢最旧的 */
const MAX_SAMPLES = 60

interface Sample {
  at: number
  p: [number, number, number]
  r: number
  s: PlayerStatePayload['s']
  a: number
}

function shortestYawDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export class RemotePlayer {
  readonly jelly: JellyBean
  private readonly tag: NameTag | null = null
  private readonly samples: Sample[] = []
  private x = 0
  private y = 0
  private z = 0
  private yaw = Math.PI
  private speed = 0
  private grounded = true
  private stunned = false
  /** 复用的状态对象，避免每帧新建 */
  private readonly state: PlayerState = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    speed: 0,
    verticalSpeed: 0,
    grounded: true,
    justLanded: false,
    stunned: false,
  }

  constructor(
    readonly id: string,
    colorHex: number,
    spawn: [number, number, number],
    nickname = '',
    maxHp = 100,
  ) {
    this.jelly = new JellyBean({ color: colorHex })
    this.x = spawn[0]
    this.y = spawn[1]
    this.z = spawn[2]
    this.jelly.group.position.set(this.x, this.y, this.z)
    this.jelly.group.rotation.y = this.yaw
    // 名字 + 血条挂在角色 group 上，Sprite 自动面向相机
    const tag = new NameTag(nickname || '玩家', colorHex, maxHp)
    tag.attachTo(this.jelly.group)
    this.tag = tag
  }

  /** 对方血量（来自他的 player_state 包 h 字段），直接画到头顶血条 */
  setHealth(hp: number, maxHp = 100): void {
    this.tag?.setHealth(hp, maxHp)
  }

  /** 对方死亡回起点：清空插值缓冲，下一包直接瞬移过去，不滑 300 m */
  snapToSpawn(): void {
    this.samples.length = 0
  }

  push(payload: PlayerStatePayload, nowMs: number): void {
    this.samples.push({ at: nowMs, p: payload.p, r: payload.r, s: payload.s, a: payload.a })
    while (this.samples.length > MAX_SAMPLES) this.samples.shift()
    // 血量随位置包一起过来（协议 v4 的 h 字段），变化时才重画
    if (typeof payload.h === 'number') this.setHealth(payload.h)
  }

  /** 供验收读取头顶血条显示的血量 */
  get health(): number {
    return this.tag?.hp ?? 0
  }

  playAttack(kind: AttackKind, side: number): void {
    this.jelly.playAttack(kind, side)
  }

  impact(kind: AttackKind): void {
    this.jelly.impact(kind)
  }

  /** 当前显示位置（命中判定用这个，和玩家看到的一致） */
  get position(): { x: number; y: number; z: number } {
    return { x: this.x, y: this.y, z: this.z }
  }

  update(dt: number, nowMs: number): void {
    const targetMs = nowMs - INTERP_DELAY * 1000
    const buf = this.samples
    if (buf.length === 0) return

    // 找到包住 targetMs 的一对采样；包不住就夹到最近的一端
    let a: Sample | null = null
    let b: Sample | null = null
    for (let i = buf.length - 1; i >= 0; i -= 1) {
      if (buf[i].at <= targetMs) {
        a = buf[i]
        b = buf[i + 1] ?? null
        break
      }
    }
    if (!a) {
      a = buf[0]
      b = buf[1] ?? null
    }
    if (!a) return

    if (b && b.at > a.at) {
      const t = THREE.MathUtils.clamp((targetMs - a.at) / (b.at - a.at), 0, 1)
      this.x = a.p[0] + (b.p[0] - a.p[0]) * t
      this.y = a.p[1] + (b.p[1] - a.p[1]) * t
      this.z = a.p[2] + (b.p[2] - a.p[2]) * t
      this.yaw = a.r + shortestYawDelta(a.r, b.r) * t
    } else {
      this.x = a.p[0]
      this.y = a.p[1]
      this.z = a.p[2]
      this.yaw = a.r
    }

    const grounded = a.s !== 'jump' && a.s !== 'fall'
    this.grounded = grounded
    this.stunned = a.s === 'knock'
    this.speed = a.a * PLAYER.sprintSpeed

    this.state.x = this.x
    this.state.y = this.y
    this.state.z = this.z
    this.state.yaw = this.yaw
    this.state.speed = this.speed
    this.state.verticalSpeed = 0
    this.state.grounded = this.grounded
    this.state.justLanded = false
    this.state.stunned = this.stunned

    this.jelly.update(dt, this.state)
  }

  dispose(): void {
    this.jelly.dispose()
    this.tag?.dispose()
    this.samples.length = 0
  }
}
