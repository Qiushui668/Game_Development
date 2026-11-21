import { OBSTACLE, PLAYER } from '@/game/core/GameConfig'

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

/** 栏架排布：每排若干段 [中心 x, 宽度]，交错留缺口 */
export interface HurdleRowDef {
  z: number
  pieces: Array<[number, number]>
}

export const HURDLE_HEIGHT = 2.2
export const HURDLE_THICKNESS = 0.8

/** 前 6 排位置与 M2 验收脚本一致，不要挪动 */
export const HURDLE_ROWS: HurdleRowDef[] = [
  { z: -34, pieces: [[-6.5, 5], [3.5, 4]] },
  { z: -58, pieces: [[-4.5, 4], [5.5, 5]] },
  { z: -82, pieces: [[-7.5, 3], [0, 6], [7.5, 3]] },
  { z: -106, pieces: [[-5.5, 5], [4.5, 4]] },
  { z: -130, pieces: [[-5, 4], [3, 3], [7.5, 3]] },
  { z: -154, pieces: [[-3.5, 5], [5.5, 4]] },
  { z: -178, pieces: [[-6, 4], [2.5, 5]] },
  { z: -202, pieces: [[-4, 5], [4.5, 3], [8, 2]] },
  { z: -226, pieces: [[-7, 4], [0, 4], [6.5, 4]] },
  { z: -250, pieces: [[-5.5, 4], [3, 5]] },
  { z: -274, pieces: [[-6.5, 3], [1, 4], [7.5, 2]] },
  { z: -298, pieces: [[-4.5, 5], [4, 4]] },
]

/** 每 48 m 一根，全部错开左右与长度，避免节奏重复 */
export const SWEEPERS: SweeperDef[] = [
  { x: -5.5, z: -22, length: 6.2, speed: 1.35, phase: 0 },
  { x: 5.5, z: -92, length: 6.6, speed: -1.15, phase: 1.1 },
  { x: -5.5, z: -118, length: 6.0, speed: 1.5, phase: 2.2 },
  { x: 5.0, z: -166, length: 5.4, speed: -1.55, phase: 3.3 },
  { x: -6.0, z: -214, length: 6.4, speed: 1.65, phase: 1.7 },
  { x: 5.5, z: -262, length: 5.8, speed: -1.4, phase: 2.9 },
  { x: -5.0, z: -310, length: 6.6, speed: 1.25, phase: 4.1 },
]

/** 滚轴：压低到顶面 1.32 m（< 跳高 1.8 m），可以跳过去；侧面还能从两端绕 */
export const ROLLERS: RollerDef[] = [
  { x: 0, z: -46, length: 9, radius: 0.65, y: 0.67, speed: 2.2, phase: 0 },
  { x: 0, z: -144, length: 9, radius: 0.65, y: 0.67, speed: 2.6, phase: 0.7 },
  { x: 0, z: -238, length: 9, radius: 0.65, y: 0.67, speed: 2.4, phase: 1.4 },
]

export interface ObstacleHit {
  /** 单位击退方向（世界 XZ） */
  dirX: number
  dirZ: number
  speed: number
  hop: number
  kind: 'sweeper' | 'roller'
}

/** 扫地杆摆臂的判定高度（轴心） */
const ARM_Y = 1.05
const ARM_TOP = ARM_Y + OBSTACLE.armRadius

export class ObstacleField {
  readonly sweepAngles: number[]
  readonly rollAngles: number[]

  constructor() {
    this.sweepAngles = SWEEPERS.map((s) => s.phase)
    this.rollAngles = ROLLERS.map((r) => r.phase)
  }

  /** 固定物理步推进（与视觉共用同一角度，杜绝半拍错位） */
  update(dt: number): void {
    const TWO_PI = Math.PI * 2
    for (let i = 0; i < SWEEPERS.length; i++) {
      this.sweepAngles[i] = (this.sweepAngles[i] + SWEEPERS[i].speed * dt) % TWO_PI
    }
    for (let i = 0; i < ROLLERS.length; i++) {
      this.rollAngles[i] = (this.rollAngles[i] + ROLLERS[i].speed * dt) % TWO_PI
    }
  }

  /** 重开一局：角度回到初始相位，避免上一局残留位置 */
  reset(): void {
    for (let i = 0; i < SWEEPERS.length; i++) this.sweepAngles[i] = SWEEPERS[i].phase
    for (let i = 0; i < ROLLERS.length; i++) this.rollAngles[i] = ROLLERS[i].phase
  }

  /**
   * 胶囊是否撞到障碍。footY 为脚底高度。
   * 返回 null 表示没撞到。
   */
  hit(x: number, footY: number, z: number): ObstacleHit | null {
    const reach = PLAYER.radius

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

      return { dirX: vx, dirZ: vz, speed: OBSTACLE.knockbackSpeed, hop: OBSTACLE.knockbackHop, kind: 'sweeper' }
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

    return null
  }
}
