/**
 * 攻击与击倒规则（纯 TS：不 import three、不碰 DOM）。
 * 单机阶段只驱动动画与自测；联机阶段服务端可直接复用这里的时长与判定，
 * 客户端只负责表现，避免两边对"第几帧算命中"理解不一致。
 */

export type AttackKind = 'light' | 'heavy'

/** 一次攻击的三段：抬起 / 命中 / 收回 */
export type AttackPhase = 'idle' | 'windup' | 'strike' | 'recover'

/** 时长单位秒：轻击命中在 0.16 s；重击举臂 1 s 后才砸下 */
export const ATTACK_TIMING = {
  light: { duration: 0.36, windupEnd: 0.1, hitAt: 0.16, strikeEnd: 0.22 },
  heavy: { duration: 1.55, windupEnd: 1.0, hitAt: 1.0, strikeEnd: 1.18 },
} as const

/** 对抗规则：轻击 3 次击倒，重击 1 次击倒，倒地眩晕 1 s */
export const COMBAT_RULES = {
  lightHitsToKnockdown: 3,
  /** 轻击计数多久没续上就清零 */
  comboWindow: 1.6,
  knockdownSeconds: 1,
  /** 字面判定距离（米）：从脚底到对方脚底的平面距离 */
  lightReach: 2.1,
  heavyReach: 2.9,
  /** 命中扇形的半角（度）：只有大致面朝对方才算打到，避免背后隔空命中 */
  hitHalfAngleDeg: 65,
  /** 竖向允许落差（米）：不在同一层不算命中 */
  hitHeightTolerance: 2.2,
} as const

/**
 * 本地出招状态机：同一时刻只能有一招，出招期间不能再出招。
 * `tick` 在命中那一帧返回攻击类型，调用方据此做表现与判定。
 */
export class AttackSystem {
  phase: AttackPhase = 'idle'
  kind: AttackKind | null = null
  /** 本招已进行的时间 */
  t = 0
  /** 下一记轻击用哪只手（左右交替） */
  side = 1
  private hitDone = false

  get canAct(): boolean {
    return this.phase === 'idle'
  }

  start(kind: AttackKind): boolean {
    if (!this.canAct) return false
    this.kind = kind
    this.phase = 'windup'
    this.t = 0
    this.hitDone = false
    if (kind === 'light') this.side = -this.side
    return true
  }

  /** 固定步推进；返回值非空表示这一帧命中 */
  tick(dt: number): AttackKind | null {
    if (!this.kind || this.phase === 'idle') return null
    const spec = ATTACK_TIMING[this.kind]
    const prev = this.t
    this.t += dt

    this.phase =
      this.t < spec.hitAt ? 'windup' : this.t < spec.strikeEnd ? 'strike' : 'recover'

    let hit: AttackKind | null = null
    if (!this.hitDone && prev < spec.hitAt && this.t >= spec.hitAt) {
      this.hitDone = true
      hit = this.kind
    }
    if (this.t >= spec.duration) this.reset()
    return hit
  }

  /** 读完帧间的当前进度，给 UI / 调试用 */
  snapshot(): { phase: AttackPhase; kind: AttackKind | null; t: number; canAct: boolean } {
    return { phase: this.phase, kind: this.kind, t: this.t, canAct: this.canAct }
  }

  reset(): void {
    this.phase = 'idle'
    this.kind = null
    this.t = 0
    this.hitDone = false
  }
}

export interface HitOutcome {
  kind: AttackKind
  /** 这一下是否把对方击倒 */
  knockdown: boolean
  /** 击倒眩晕时长（秒），未击倒为 0 */
  stunSeconds: number
  /** 累计轻击次数（重击不改动轻击计数） */
  lightHits: number
}

/**
 * 受击方计数（每个角色一份）：轻击累计到 3 次击倒并清零，重击直接击倒。
 * 联机阶段服务端为每个玩家持有一个实例即可。
 */
export class HitTracker {
  lightHits = 0
  knockdowns = 0
  /** 最近一次眩晕剩余时间 */
  stunLeft = 0
  private windowLeft = 0

  get down(): boolean {
    return this.stunLeft > 0
  }

  tick(dt: number): void {
    if (this.stunLeft > 0) this.stunLeft = Math.max(0, this.stunLeft - dt)
    if (this.windowLeft > 0) {
      this.windowLeft -= dt
      if (this.windowLeft <= 0 && !this.down) this.lightHits = 0
    }
  }

  /** 调试 / HUD 快照 */
  snapshot(): { lightHits: number; knockdowns: number; stunLeft: number; down: boolean } {
    return {
      lightHits: this.lightHits,
      knockdowns: this.knockdowns,
      stunLeft: this.stunLeft,
      down: this.down,
    }
  }

  reset(): void {
    this.lightHits = 0
    this.knockdowns = 0
    this.stunLeft = 0
    this.windowLeft = 0
  }

  apply(kind: AttackKind): HitOutcome {
    if (kind === 'heavy') {
      this.knockdowns++
      this.lightHits = 0
      this.windowLeft = 0
      this.stunLeft = COMBAT_RULES.knockdownSeconds
      return {
        kind,
        knockdown: true,
        stunSeconds: COMBAT_RULES.knockdownSeconds,
        lightHits: 0,
      }
    }

    this.lightHits++
    this.windowLeft = COMBAT_RULES.comboWindow
    if (this.lightHits >= COMBAT_RULES.lightHitsToKnockdown) {
      this.knockdowns++
      this.lightHits = 0
      this.windowLeft = 0
      this.stunLeft = COMBAT_RULES.knockdownSeconds
      return {
        kind,
        knockdown: true,
        stunSeconds: COMBAT_RULES.knockdownSeconds,
        lightHits: COMBAT_RULES.lightHitsToKnockdown,
      }
    }
    return { kind, knockdown: false, stunSeconds: 0, lightHits: this.lightHits }
  }
}
