import { BRIDGE, GLOVE, OBSTACLE, PLAYER, TRACK } from '@/game/core/GameConfig'
import { QUIZ_GATES } from '@/game/quiz/QuizSystem'

/**
 * 障碍布局与命中判定（纯 TS：不 import three、不碰 DOM）。
 * 视觉（World）与判定共用这一份数据，避免"看得见撞不到"。
 * 后续联机阶段服务端可直接复用本模块做权威判定。
 */

/** 旋转扫地杆（绕立柱公转的摆臂） */
export interface SweeperDef {
  x: number
  z: number
  /** 摆臂长度（米） */
  length: number
  /** 角速度（rad/s），正负决定旋转方向 */
  speed: number
  /** 初始相位（rad） */
  phase: number
}

/** 横跨赛道的滚轴（沿 X 轴，绕自身轴转） */
export interface RollerDef {
  x: number
  z: number
  /** 长度（沿 X） */
  length: number
  radius: number
  /** 轴心高度 */
  y: number
  speed: number
  phase: number
}

/** 地刺：整条按周期顶起/缩回，顶起时碰到就扣血 */
export interface SpikeDef {
  z: number
  /** 沿 X 的宽度 */
  width: number
  /** 沿 Z 的长度 */
  length: number
  /** 一个完整升降周期的秒数 */
  cycle: number
  /** 相位（0..1，表示周期内的起始位置） */
  phase: number
  /** 地刺完全顶起时的刺尖高度 */
  height: number
}

/** 大摆锤：绕横跨赛道的高悬点做钟摆扫动 */
export interface PendulumDef {
  /** 悬挂点 X（居中为 0） */
  x: number
  /** 悬挂点 Z */
  z: number
  /** 悬挂点高度 */
  pivotY: number
  /** 悬挂点到锤头中心的臂长 */
  armLength: number
  /** 最大摆角（rad） */
  swing: number
  /** 角频率（rad/s） */
  speed: number
  /** 相位（rad） */
  phase: number
  /** 锤头半径（判定尺度，也是视觉球半径） */
  headRadius: number
}

/** 栏架排布：每排若干段 [中心 x, 宽度]，交错留缺口 */
export interface HurdleRowDef {
  z: number
  pieces: Array<[number, number]>
}

export const HURDLE_HEIGHT = 2.2
export const HURDLE_THICKNESS = 0.8

/** 前 5 排位置与 M2 验收脚本一致，不要挪动；浮桥段（-142…-175）整段不排栏架 */
export const HURDLE_ROWS: HurdleRowDef[] = [
  { z: -34, pieces: [[-6.5, 5], [3.5, 4]] },
  { z: -58, pieces: [[-4.5, 4], [5.5, 5]] },
  { z: -82, pieces: [[-7.5, 3], [0, 6], [7.5, 3]] },
  { z: -106, pieces: [[-5.5, 5], [4.5, 4]] },
  { z: -130, pieces: [[-5, 4], [3, 3], [7.5, 3]] },
  { z: -178, pieces: [[-6, 4], [2.5, 5]] },
  { z: -202, pieces: [[-4, 5], [4.5, 3], [8, 2]] },
  { z: -226, pieces: [[-7, 4], [0, 4], [6.5, 4]] },
  { z: -250, pieces: [[-5.5, 4], [3, 5]] },
  { z: -274, pieces: [[-6.5, 3], [1, 4], [7.5, 2]] },
  { z: -298, pieces: [[-4.5, 5], [4, 4]] },
]

/** 每 48 m 一根，全部错开左右与长度，避免节奏重复（第 4 根挪到浮桥段之后 -292.5） */
export const SWEEPERS: SweeperDef[] = [
  { x: -5.5, z: -22, length: 6.2, speed: 1.35 * OBSTACLE.sweepSpeedScale, phase: 0 },
  { x: 5.5, z: -92, length: 6.6, speed: -1.15 * OBSTACLE.sweepSpeedScale, phase: 1.1 },
  { x: -5.5, z: -118, length: 6.0, speed: 1.5 * OBSTACLE.sweepSpeedScale, phase: 2.2 },
  { x: 5.0, z: -292.5, length: 4.6, speed: -1.55 * OBSTACLE.sweepSpeedScale, phase: 3.3 },
  { x: -6.0, z: -214, length: 6.4, speed: 1.65 * OBSTACLE.sweepSpeedScale, phase: 1.7 },
  { x: 5.5, z: -262, length: 5.8, speed: -1.4 * OBSTACLE.sweepSpeedScale, phase: 2.9 },
  { x: -5.0, z: -310, length: 6.6, speed: 1.25 * OBSTACLE.sweepSpeedScale, phase: 4.1 },
]

/** 滚轴：压低到顶面 1.32 m（< 跳高 1.8 m），可以跳过去；侧面还能从两端绕（第 2 根挪到 -205） */
export const ROLLERS: RollerDef[] = [
  { x: 0, z: -46, length: 9, radius: 0.65, y: 0.67, speed: 2.2, phase: 0 },
  { x: 0, z: -205, length: 9, radius: 0.65, y: 0.67, speed: 2.6, phase: 0.7 },
  { x: 0, z: -238, length: 9, radius: 0.65, y: 0.67, speed: 2.4, phase: 1.4 },
]

/**
 * 地刺：挑在原有障碍之间的空档，宽度都小于赛道，保证始终有绕行通道。
 * 顶起占周期的 55%，剩下 45% 完全缩回地面。
 */
export const SPIKE_STRIPS: SpikeDef[] = [
  { z: -40, width: 7, length: 3, cycle: 2.6, phase: 0.0, height: 1.0 },
  { z: -100, width: 8, length: 2.6, cycle: 2.2, phase: 0.45, height: 1.0 },
  { z: -190, width: 7.5, length: 3, cycle: 2.8, phase: 0.2, height: 1.0 },
  { z: -286, width: 6.5, length: 3, cycle: 2.4, phase: 0.65, height: 1.0 },
]

/** 大摆锤：两根，锤头最低点约 1.5 m，正中扫过时必然命中，两侧悬空可钻（第 1 根挪到 -109.2） */
export const PENDULUMS: PendulumDef[] = [
  { x: 0, z: -109.2, pivotY: 6.4, armLength: 4.9, swing: 0.82, speed: 1.55, phase: 0, headRadius: 0.9 },
  { x: 0, z: -232, pivotY: 7.0, armLength: 5.4, swing: 0.95, speed: 1.25, phase: 1.4, headRadius: 1.0 },
]

/**
 * 巨型拳击手套：挂在左右墙上的固定挂钩，**只沿 Z 前后来回滑动**（不左右移动），
 * 每个挂钩按自己的周期随机探拳。打中 = 扣光 100 血后把人打飞出赛道（淘汰 → 回起点复活）。
 * 位置全部挑在其它障碍的 Z 空档里（不与扫地杆/滚轴/地刺/摆锤/栏架/答题墙重叠），
 * 左右交替、前后拉开：起跑段一只（右墙）→ 中段（左墙）→ 后半（右墙）→ 尾段（左墙）。
 */
export interface GloveDef {
  /** 挂左墙（-1）还是右墙（+1） */
  side: -1 | 1
  /** 沿 Z 滑动的中心 */
  zCenter: number
  /** 滑动半径（±米） */
  zRange: number
  /** 滑动速度（m/s）：三角波来回的速度 */
  slideSpeed: number
  /** 滑动相位 0..1（错开每只手套的节奏） */
  slidePhase: number
  /** 出拳周期的相位 0..1 */
  punchPhase: number
}

/**
 * 4 只拳套的 Z 区间都落在其它障碍的空档里（body ±1.5 m 也不碰到邻居，两侧最近留 ≥0.9 m）：
 *  - 起跑段：-8.8..-13.2（下一根扫地杆 -15.8 才起步，且它在左半、拳套在右墙）
 *  - 前中段：-137.1..-141.1（答题墙 2 在 -136、浮桥挖空段从 -142 起，中间只留这一条缝，所以滑幅收窄）
 *  - 后半：  -179.8..-187.2（栏架 -178.4 与地刺 -188.5 之间）
 *  - 尾段：  -239.5..-247.7（滚轴 -237.3 与栏架 -249.6 之间，居中放）
 */
export const GLOVES: GloveDef[] = [
  { side: 1, zCenter: -11, zRange: 2.2, slideSpeed: 1.15, slidePhase: 0.2, punchPhase: 0.1 },
  { side: -1, zCenter: -139.4, zRange: 0.8, slideSpeed: 0.95, slidePhase: 0.6, punchPhase: 0.45 },
  { side: 1, zCenter: -183.5, zRange: 2.2, slideSpeed: 1.25, slidePhase: 0.85, punchPhase: 0.7 },
  { side: -1, zCenter: -243.6, zRange: 2.6, slideSpeed: 1.05, slidePhase: 0.05, punchPhase: 0.9 },
]

/** 手套当前状态：滑动到的 z、拳头探出比例 0..1、蓄力回拉比例 0..1 */
export interface GloveState {
  z: number
  /** 0 = 缩在墙里，1 = 完全探出 */
  extend: number
  /** 蓄力时拳头往后拉的比例（视觉用，判定不算） */
  wind: number
}

const mod1 = (v: number): number => ((v % 1) + 1) % 1

/** 滑动位置：三角波，永远只在 Z 轴上往返（绝不左右移动） */
export function gloveZ(def: GloveDef, elapsed: number): number {
  // 一个完整往返 = 4 段 zRange / slideSpeed
  const period = (4 * def.zRange) / Math.max(0.01, def.slideSpeed)
  const u = mod1(elapsed / period + def.slidePhase)
  const tri = u < 0.5 ? u * 4 - 1 : 3 - u * 4
  return def.zCenter + def.zRange * tri
}

/**
 * 出拳节奏（0..1 周期内）：
 * 0–0.18 蓄力后拉 → 0.18–0.30 快速出拳 → 0.30–0.48 保持 → 0.48–0.66 收回 → 其余待机
 */
export function glovePunch(def: GloveDef, elapsed: number): { extend: number; wind: number } {
  const u = mod1(elapsed / GLOVE.cycle + def.punchPhase)
  if (u < 0.18) return { extend: 0, wind: u / 0.18 }
  if (u < 0.3) {
    const p = (u - 0.18) / 0.12
    // ease-out：起步极快，末端稳住
    return { extend: 1 - (1 - p) * (1 - p), wind: 0 }
  }
  if (u < 0.48) return { extend: 1, wind: 0 }
  if (u < 0.66) {
    const p = (u - 0.48) / 0.18
    return { extend: 1 - p, wind: 0 }
  }
  return { extend: 0, wind: 0 }
}

/** 拳心世界坐标（判定与视觉共用） */
export function gloveFist(def: GloveDef, state: GloveState): { x: number; y: number; z: number } {
  const wallX = (TRACK.width / 2) * def.side
  const back = state.wind * 0.8
  return {
    x: wallX - def.side * (GLOVE.reach * state.extend - back),
    y: GLOVE.fistY,
    z: state.z,
  }
}

export interface ObstacleHit {
  /** 单位击退方向（世界 XZ） */
  dirX: number
  dirZ: number
  speed: number
  hop: number
  kind: 'sweeper' | 'roller' | 'spike' | 'pendulum' | 'glove'
  /** 直接淘汰（拳套打飞）：不走扣血，飞出去后回起点复活 */
  eliminate?: boolean
}

/** 扫地杆摆臂的判定高度（轴心） */
const ARM_Y = 1.05
const ARM_TOP = ARM_Y + OBSTACLE.armRadius

/** 地刺周期里"顶起"所占的比例，其余时间完全缩回 */
const SPIKE_UP_FRACTION = 0.55
/** 地刺顶到多高才具备伤害（低于这个是正在冒头/缩回，不判定） */
const SPIKE_HIT_RISE = 0.45

/** 单根地刺的当前顶起量（0 = 完全缩回，1 = 完全顶起）；给视觉与判定共用 */
export function spikeRise(def: SpikeDef, elapsed: number): number {
  const u = ((elapsed / def.cycle + def.phase) % 1 + 1) % 1
  if (u >= SPIKE_UP_FRACTION) return 0
  const p = u / SPIKE_UP_FRACTION
  // 0 → 1 → 1 → 0：冒头 30%、保持 40%、缩回 30%
  if (p < 0.3) return p / 0.3
  if (p < 0.7) return 1
  return 1 - (p - 0.7) / 0.3
}

/** 大摆锤当前的摆角（rad，0 = 垂直向下） */
export function pendulumAngle(def: PendulumDef, elapsed: number): number {
  return def.swing * Math.sin(elapsed * def.speed + def.phase)
}

export class ObstacleField {
  readonly sweepAngles: number[]
  readonly rollAngles: number[]
  /** 地刺顶起量 0..1，视觉直接读 */
  readonly spikeRise: number[]
  /** 摆锤摆角（rad） */
  readonly pendulumAngles: number[]
  /** 拳击手套：滑动位置 / 探出比例 / 蓄力（视觉与判定同一份） */
  readonly gloves: GloveState[] = GLOVES.map((def) => ({
    z: gloveZ(def, 0),
    extend: 0,
    wind: 0,
  }))
  /** 运行时长：地刺与摆锤都是绝对时间函数，暂停/重开都干净 */
  private elapsed = 0

  constructor() {
    this.sweepAngles = SWEEPERS.map((s) => s.phase)
    this.rollAngles = ROLLERS.map((r) => r.phase)
    this.spikeRise = SPIKE_STRIPS.map((s) => spikeRise(s, 0))
    this.pendulumAngles = PENDULUMS.map((p) => pendulumAngle(p, 0))
    this.refreshGloves()
  }

  /** 固定物理步推进（与视觉共用同一角度，杜绝半拍错位） */
  update(dt: number): void {
    const TWO_PI = Math.PI * 2
    this.elapsed += dt
    for (let i = 0; i < SWEEPERS.length; i++) {
      this.sweepAngles[i] = (this.sweepAngles[i] + SWEEPERS[i].speed * dt) % TWO_PI
    }
    for (let i = 0; i < ROLLERS.length; i++) {
      this.rollAngles[i] = (this.rollAngles[i] + ROLLERS[i].speed * dt) % TWO_PI
    }
    for (let i = 0; i < SPIKE_STRIPS.length; i++) {
      this.spikeRise[i] = spikeRise(SPIKE_STRIPS[i], this.elapsed)
    }
    for (let i = 0; i < PENDULUMS.length; i++) {
      this.pendulumAngles[i] = pendulumAngle(PENDULUMS[i], this.elapsed)
    }
    this.refreshGloves()
  }

  private refreshGloves(): void {
    for (let i = 0; i < GLOVES.length; i++) {
      const def = GLOVES[i]
      const punch = glovePunch(def, this.elapsed)
      this.gloves[i].z = gloveZ(def, this.elapsed)
      this.gloves[i].extend = punch.extend
      this.gloves[i].wind = punch.wind
    }
  }

  /** 重开一局：角度回到初始相位，避免上一局残留位置 */
  reset(): void {
    this.elapsed = 0
    for (let i = 0; i < SWEEPERS.length; i++) this.sweepAngles[i] = SWEEPERS[i].phase
    for (let i = 0; i < ROLLERS.length; i++) this.rollAngles[i] = ROLLERS[i].phase
    for (let i = 0; i < SPIKE_STRIPS.length; i++) this.spikeRise[i] = spikeRise(SPIKE_STRIPS[i], 0)
    for (let i = 0; i < PENDULUMS.length; i++) {
      this.pendulumAngles[i] = pendulumAngle(PENDULUMS[i], 0)
    }
    this.refreshGloves()
  }

  /** 摆锤锤头中心（世界坐标），视觉从同一定义出发画 */
  static pendulumHead(def: PendulumDef, angle: number): { x: number; y: number; z: number } {
    return {
      x: def.x + Math.sin(angle) * def.armLength,
      y: def.pivotY - Math.cos(angle) * def.armLength,
      z: def.z,
    }
  }

  /**
   * 胶囊是否撞到障碍。footY 为脚底高度。
   * 返回 null 表示没撞到。
   */
  hit(x: number, footY: number, z: number): ObstacleHit | null {
    const reach = PLAYER.radius

    // 巨型拳击手套：只在拳头探出过半时判定（正在收/正在出拳的半程不算）
    for (let i = 0; i < GLOVES.length; i++) {
      const def = GLOVES[i]
      const state = this.gloves[i]
      if (state.extend < GLOVE.hitMinExtend) continue
      const fist = gloveFist(def, state)
      if (fist.y + GLOVE.fistRadius < footY) continue
      if (fist.y - GLOVE.fistRadius > footY + PLAYER.height) continue
      const dx = x - fist.x
      const dz = z - fist.z
      if (Math.hypot(dx, dz) > GLOVE.fistRadius + reach) continue
      // 往赛道里侧 + 终点方向一起甩：横向（远离墙）为主，带一点往前推
      const len = Math.hypot(1, 0.55)
      return {
        dirX: -def.side / len,
        dirZ: -0.55 / len,
        speed: GLOVE.knockbackSpeed,
        hop: GLOVE.knockbackHop,
        kind: 'glove',
        eliminate: true,
      }
    }

    // 扫地杆：只在脚底低于摆臂顶部时命中——跳过去可以从上面越过
    for (let i = 0; i < SWEEPERS.length; i++) {
      const s = SWEEPERS[i]
      if (footY > ARM_TOP) continue
      const th = this.sweepAngles[i]
      const ax = Math.cos(th)
      const az = -Math.sin(th)
      const dx = x - s.x
      const dz = z - s.z
      const along = dx * ax + dz * az
      if (along < -OBSTACLE.armRadius || along > s.length + OBSTACLE.armRadius) continue
      const signedPerp = -dx * az + dz * ax
      if (Math.abs(signedPerp) > OBSTACLE.armRadius + reach) continue

      // 击退方向：摆臂切向（跟随旋转方向）为主，掺一点沿臂径向外推，避免贴边反复命中
      const swing = Math.sign(s.speed) || 1
      const tx = -Math.sin(th) * swing
      const tz = -Math.cos(th) * swing
      const radial = signedPerp >= 0 ? 1 : -1
      let vx = tx + -az * radial * 0.35
      let vz = tz + ax * radial * 0.35
      const len = Math.hypot(vx, vz) || 1
      vx /= len
      vz /= len

      return {
        dirX: vx,
        dirZ: vz,
        speed: OBSTACLE.sweepKnockbackSpeed,
        hop: OBSTACLE.sweepKnockbackHop,
        kind: 'sweeper',
      }
    }

    // 滚轴：低于顶面就会被顶回去，够高可以直接跳过
    for (let i = 0; i < ROLLERS.length; i++) {
      const r = ROLLERS[i]
      if (footY > r.y + r.radius) continue
      if (Math.abs(z - r.z) > r.radius + reach) continue
      if (Math.abs(x - r.x) > r.length / 2 + reach) continue
      // 绕 +X 正向转时，接触面往 +Z 走，把人往起点方向顶
      const dir = Math.sign(r.speed) || 1
      return { dirX: 0, dirZ: dir, speed: OBSTACLE.knockbackSpeed, hop: OBSTACLE.knockbackHop, kind: 'roller' }
    }

    // 地刺：顶起到一定高度才有伤害，缩回时是安全窗口
    for (let i = 0; i < SPIKE_STRIPS.length; i++) {
      const s = SPIKE_STRIPS[i]
      const rise = this.spikeRise[i]
      if (rise < SPIKE_HIT_RISE) continue
      if (footY > s.height * rise) continue
      if (Math.abs(z - s.z) > s.length / 2 + reach) continue
      if (Math.abs(x) > s.width / 2 + reach) continue
      // 脚下往上顶：连同击退一起给足，保证被顶离刺阵（不然会站在原地连吃）
      return { dirX: 0, dirZ: 1, speed: OBSTACLE.knockbackSpeed, hop: OBSTACLE.knockbackHop, kind: 'spike' }
    }

    // 大摆锤：锤头球体与胶囊在 XZ 上的距离判定，配合高度重叠
    for (let i = 0; i < PENDULUMS.length; i++) {
      const p = PENDULUMS[i]
      const head = ObstacleField.pendulumHead(p, this.pendulumAngles[i])
      const hr = p.headRadius
      if (head.y < footY - hr || head.y > footY + PLAYER.height + hr) continue
      const dx = x - head.x
      const dz = z - head.z
      const dist = Math.hypot(dx, dz)
      if (dist > hr + reach) continue

      // 横向推开为主；正好在锤头正下方时按摆动方向甩出去
      let vx = dx
      let vz = dz + 0.35
      if (Math.hypot(vx, vz) < 0.05) vx = Math.sin(this.pendulumAngles[i]) >= 0 ? 1 : -1
      const len = Math.hypot(vx, vz) || 1
      return {
        dirX: vx / len,
        dirZ: vz / len,
        speed: OBSTACLE.knockbackSpeed,
        hop: OBSTACLE.knockbackHop,
        kind: 'pendulum',
      }
    }

    return null
  }
}

/** 一个障碍在俯视图上占的矩形（X/Z），给"布局不许重叠"的自动检查用 */
export interface LayoutBand {
  name: string
  xMin: number
  xMax: number
  zMin: number
  zMax: number
}

/** 浮桥单块在俯视图上的最大占位（左右扫到两端时会扫过的整条带；6 块共用同一条边界） */
export function bridgePlatformBand(index: number): LayoutBand {
  const cz = BRIDGE.firstZ - index * BRIDGE.pitch
  const halfW = BRIDGE.width / 2 + BRIDGE.swingX
  return {
    name: `浮桥${index + 1}`,
    xMin: -halfW,
    xMax: halfW,
    zMin: cz - BRIDGE.depth / 2,
    zMax: cz + BRIDGE.depth / 2,
  }
}

/** 浮桥段被挖空的那片地面：没有任何障碍可以悬在洞上 */
export function bridgeVoidBand(): LayoutBand {
  return {
    name: '浮桥段(挖空)',
    xMin: -TRACK.width / 2,
    xMax: TRACK.width / 2,
    zMin: BRIDGE.gapZEnd,
    zMax: BRIDGE.gapZStart,
  }
}

/** 两个矩形在 XZ 上是否相交（超过 eps） */
export function bandsOverlap(a: LayoutBand, b: LayoutBand, eps = 0.05): boolean {
  const dz = Math.min(a.zMax, b.zMax) - Math.max(a.zMin, b.zMin)
  const dx = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin)
  return dz > eps && dx > eps
}

/**
 * 把所有障碍摊到俯视图的矩形里：扫地杆按摆臂扫掠圆、滚轴按自身尺寸、
 * 地刺/栏架/答题墙按实体、拳套按"完全探出时"的整只范围、浮桥按"摆到两端"的最大范围。
 */
export function layoutBands(): LayoutBand[] {
  const halfW = TRACK.width / 2
  const bands: LayoutBand[] = []

  SWEEPERS.forEach((s, i) => {
    bands.push({
      name: `扫地杆${i + 1}`,
      xMin: s.x - s.length,
      xMax: s.x + s.length,
      zMin: s.z - s.length,
      zMax: s.z + s.length,
    })
  })
  ROLLERS.forEach((r, i) => {
    bands.push({
      name: `滚轴${i + 1}`,
      xMin: r.x - r.length / 2,
      xMax: r.x + r.length / 2,
      zMin: r.z - r.radius,
      zMax: r.z + r.radius,
    })
  })
  SPIKE_STRIPS.forEach((s, i) => {
    bands.push({
      name: `地刺${i + 1}`,
      xMin: -s.width / 2,
      xMax: s.width / 2,
      zMin: s.z - s.length / 2,
      zMax: s.z + s.length / 2,
    })
  })
  PENDULUMS.forEach((p, i) => {
    const swing = p.armLength * Math.sin(p.swing) + p.headRadius
    bands.push({
      name: `摆锤${i + 1}`,
      xMin: p.x - swing,
      xMax: p.x + swing,
      zMin: p.z - p.headRadius,
      zMax: p.z + p.headRadius,
    })
  })
  HURDLE_ROWS.forEach((row, i) => {
    for (const [cx, w] of row.pieces) {
      bands.push({
        name: `栏架${i + 1}`,
        xMin: cx - w / 2,
        xMax: cx + w / 2,
        zMin: row.z - HURDLE_THICKNESS / 2,
        zMax: row.z + HURDLE_THICKNESS / 2,
      })
    }
  })
  GLOVES.forEach((g, i) => {
    const punch = GLOVE.reach + GLOVE.fistRadius
    const xMin = g.side > 0 ? halfW - punch : -halfW
    const xMax = g.side > 0 ? halfW : -halfW + punch
    bands.push({
      name: `拳套${i + 1}`,
      xMin,
      xMax,
      zMin: g.zCenter - g.zRange - GLOVE.fistRadius,
      zMax: g.zCenter + g.zRange + GLOVE.fistRadius,
    })
  })
  QUIZ_GATES.forEach((g, i) => {
    bands.push({ name: `答题墙${i + 1}`, xMin: -halfW, xMax: halfW, zMin: g.z - 0.4, zMax: g.z + 0.4 })
  })
  for (let i = 0; i < BRIDGE.count; i++) bands.push(bridgePlatformBand(i))
  return bands
}

/** 两两检查布局：X 与 Z 都重叠（超过 eps）就算撞了，返回冲突对 */
export function layoutConflicts(eps = 0.05): Array<[string, string]> {
  const bands = layoutBands()
  const out: Array<[string, string]> = []
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i]
      const b = bands[j]
      // 同一排栏架的不同段本来就是并排摆的，跳过
      if (a.name === b.name) continue
      if (bandsOverlap(a, b, eps)) out.push([a.name, b.name])
    }
  }
  return out
}

/** 检查"有没有障碍悬在浮桥的挖空洞上"，返回压到洞里的障碍名 */
export function bridgeVoidConflicts(eps = 0.05): string[] {
  const hole = bridgeVoidBand()
  return layoutBands()
    .filter((b) => !b.name.startsWith('浮桥'))
    .filter((b) => bandsOverlap(b, hole, eps))
    .map((b) => b.name)
}
