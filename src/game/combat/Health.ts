import { HEALTH } from '@/game/core/GameConfig'

/**
 * 生命值状态（纯 TS，方便无渲染环境做验收）。
 * 规则：满血 100；任何障碍命中 −10；轻击 −34；重击 −70；归零即死（上层负责回起点）。
 */
export class HealthState {
  hp: number = HEALTH.max
  /** 最近一次受伤来源，给 HUD 做提示 */
  lastCause: 'obstacle' | 'light' | 'heavy' | null = null
  /** 累计受到的伤害，调试用 */
  totalDamage = 0
  /** 死亡次数 */
  deaths = 0

  get max(): number {
    return HEALTH.max
  }

  get ratio(): number {
    return Math.max(0, this.hp) / HEALTH.max
  }

  get alive(): boolean {
    return this.hp > 0
  }

  /**
   * 扣血，返回"这一下是否致死"。
   * 已经死了就不重复扣（避免同帧多源命中把 -hp 扣穿）。
   */
  damage(amount: number, cause: 'obstacle' | 'light' | 'heavy'): boolean {
    if (this.hp <= 0) return false
    this.totalDamage += amount
    this.lastCause = cause
    this.hp -= amount
    if (this.hp <= 0) {
      this.hp = 0
      this.deaths++
      return true
    }
    return false
  }

  /** 复活/重开：回满 */
  reset(): void {
    this.hp = HEALTH.max
    this.lastCause = null
  }
}
