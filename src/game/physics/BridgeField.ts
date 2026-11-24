import { BRIDGE } from '@/game/core/GameConfig'

/**
 * 浮桥（B2.0，纯 TS：不 import three、不碰 DOM / 物理）。
 *
 * 答题墙 2（-136）到答题墙 3（-196）之间那 33 m 地面被整体挖空，
 * 只在中间摆 6 块 3.6 m × 3.6 m 的浮桥。横向摆动规则（用户指定）：
 *
 *   1. 起步位置奇偶交替 —— 第 1 块在最左（−swingX）、第 2 块在最右（+swingX）、
 *      第 3 块又在最左，以此类推；
 *   2. 6 块**同时**做横向移动，每块都在 ±swingX 之间**匀速**扫，走到某一边的边界
 *      立刻自动反向（三角波往返，不是正弦一口气来回）；
 *   3. 因为起点左右相反，相邻两块永远是"镜像"着扫：一块往右，另一块就往左。
 *      |x| 同步，所以相邻两块的横向落差在 0 … 2·swingX 之间变；
 *      swingX = 7.1 m（板边贴到 ±8.9 的护栏内壁）时最坏落差 14.2 m，
 *      孔距 5.5 m、冲刺平跳约 7.9 m —— 只有两块在中间交汇（落差 < 5.7 m）的那段时间跳得过去，
 *      板速 3.55 m/s（单程 4 s），交汇窗口约 1.6 s，所以要掐着时间连跳。
 *
 * 物理侧（World）把每块做成 kinematic 刚体，视觉侧每帧读这里的 x；
 * 站在板上的人由 Game 调用 carryDelta 一起横向带走（角色控制器不继承平台速度）。
 */
export interface BridgePlatformState {
  index: number
  /** 起步侧：-1 = 最左（第 1/3/5 块）、+1 = 最右（第 2/4/6 块）；运动中按它镜像 */
  side: number
  /** 中心 Z（沿赛道依次排开） */
  z: number
  /** 当前 X */
  x: number
  /** 上一步的 X（判定"人是不是站在这块板上"用这个，避免板先动、人被落下） */
  prevX: number
  /** 本步横向位移，站在板上的人要跟着挪 */
  dx: number
}

export class BridgeField {
  readonly platforms: BridgePlatformState[] = []
  /** 累计时间（秒）：与障碍一样用绝对时间函数，重开一局干净归零（又回到"1 左 2 右"） */
  private elapsed = 0

  constructor() {
    for (let i = 0; i < BRIDGE.count; i++) {
      this.platforms.push({
        index: i,
        side: i % 2 === 0 ? -1 : 1,
        z: BRIDGE.firstZ - i * BRIDGE.pitch,
        x: 0,
        prevX: 0,
        dx: 0,
      })
    }
    this.reset()
  }

  /** 重开一局：往返相位归零，重新算一遍初始位置（第 1 块回到最左） */
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

  /**
   * 位置函数：u(t) 是从 +1 匀速走到 −1 再匀速走回 +1 的三角波（单程 travelSeconds），
   * 板心 x = side · swingX · u(t)。到边界（u = ±1）速度立刻反号，没有减速段。
   */
  positionOf(index: number, t: number): number {
    const oneWay = BRIDGE.travelSeconds
    const cycle = oneWay * 2
    const phase = (((t % cycle) + cycle) % cycle) / cycle
    const u = phase < 0.5 ? 1 - 4 * phase : -3 + 4 * phase
    return this.platforms[index].side * BRIDGE.swingX * u
  }

  /** 验收快照：每块板当前位置 + 共同摆动边界 */
  snapshot(): Array<{
    index: number
    x: number
    z: number
    side: number
    minX: number
    maxX: number
  }> {
    return this.platforms.map((p) => ({
      index: p.index,
      x: p.x,
      z: p.z,
      side: p.side,
      minX: -BRIDGE.swingX,
      maxX: BRIDGE.swingX,
    }))
  }
}
