import { BRIDGE } from '@/game/core/GameConfig'

/**
 * 浮桥（B2.0，纯 TS：不 import three、不碰 DOM / 物理）。
 *
 * 答题墙 2（-136）到答题墙 3（-196）之间那 33 m 地面被整体挖空，
 * 只在中间摆 6 块 3.6 m × 3.6 m 的浮桥，每块**各自沿 X 左右来回摆**：
 *   x = 中心 ± 幅度 · sin(ω t + 相位)
 * 奇偶块左右错开（±1.2 m），相邻块相位差 0.18 rad —— 看起来是 6 块各自动，
 * 实际相邻两块的横向落差最大只有 ~2.7 m，配 5.5 m 跳距完全跳得过去。
 *
 * 物理侧（World）把每块做成 kinematic 刚体，视觉侧每帧读这里的 x；
 * 站在板上的人由 Game 调用 carryDelta 一起横向带走（角色控制器不继承平台速度）。
 */
export interface BridgePlatformState {
  index: number
  /** 摆动中心 X（奇偶左右错开） */
  cx: number
  /** 中心 Z（沿赛道依次排开） */
  z: number
  /** 当前 X */
  x: number
  /** 上一步的 X（判定"人是不是站在这块板上"用这个，避免板先动、人被落下） */
  prevX: number
  /** 本步横向位移，站在板上的人要跟着挪 */
  dx: number
}

const TWO_PI = Math.PI * 2

export class BridgeField {
  readonly platforms: BridgePlatformState[] = []
  /** 累计时间（秒）：与障碍一样用绝对时间函数，重开一局干净归零 */
  private elapsed = 0

  constructor() {
    for (let i = 0; i < BRIDGE.count; i++) {
      this.platforms.push({
        index: i,
        cx: i % 2 === 0 ? -BRIDGE.offsetX : BRIDGE.offsetX,
        z: BRIDGE.firstZ - i * BRIDGE.pitch,
        x: 0,
        prevX: 0,
        dx: 0,
      })
    }
    this.reset()
  }

  /** 重开一局：摆动相位归零，重新算一遍初始位置 */
  reset(): void {
    this.elapsed = 0
    for (const p of this.platforms) {
      p.x = this.positionOf(p.index, 0)
      p.prevX = p.x
      p.dx = 0
    }
  }

  /** 固定物理步推进：记录每块板的位移，供"站在板上的人跟着挪" */
  update(h: number): void {
    this.elapsed += h
    for (const p of this.platforms) {
      p.prevX = p.x
      p.x = this.positionOf(p.index, this.elapsed)
      p.dx = p.x - p.prevX
    }
  }

  /**
   * 站在板上的人这一小步应该跟着横移多少：不在板上返回 0。
   * 返回位移后把 dx 清零（一步只结算一次，暂停/冻结时不会重复累加）。
   */
  carryDelta(x: number, z: number, feetY: number, grounded: boolean): number {
    if (!grounded || feetY > 0.5 || feetY < -0.4) return 0
    for (const p of this.platforms) {
      const halfW = BRIDGE.width / 2 + 0.35
      const halfD = BRIDGE.depth / 2 + 0.35
      if (Math.abs(x - p.prevX) > halfW) continue
      if (Math.abs(z - p.z) > halfD) continue
      const d = p.dx
      p.dx = 0
      return d
    }
    return 0
  }

  /** X 的解析位置：中心 ± 幅度 sin(ω t + 相位) */
  positionOf(index: number, t: number): number {
    const p = this.platforms[index]
    const omega = TWO_PI / BRIDGE.periodSeconds
    const phase = index * BRIDGE.phaseStep
    return p.cx + BRIDGE.amplitudeX * Math.sin(omega * t + phase)
  }

  /** 验收快照：每块板当前位置 + 摆动范围 */
  snapshot(): Array<{ index: number; x: number; z: number; cx: number; minX: number; maxX: number }> {
    return this.platforms.map((p) => ({
      index: p.index,
      x: p.x,
      z: p.z,
      cx: p.cx,
      minX: p.cx - BRIDGE.amplitudeX,
      maxX: p.cx + BRIDGE.amplitudeX,
    }))
  }
}
