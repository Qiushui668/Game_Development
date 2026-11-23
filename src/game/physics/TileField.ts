import { BRIDGE, TILE, TRACK } from '@/game/core/GameConfig'

/**
 * 赛道方格（纯 TS：不 import three、不碰 DOM）。
 *
 * 整条主赛道就是一张 3 m × 3 m 的方格网（6 列 × 114 行 = 684 块），每块的外观完全一致：
 * 同一尺寸、同一张棋盘贴图、同一个高度 —— 玩家**看不出**哪块会塌、哪块会弹。
 * 开局每块独立随机抽身份：
 *   - vanish：踩上去先抖 0.3 s 再塌 → 人掉进虚空回起点
 *   - bounce：踩上去立刻往 +Z（起点方向）弹回十几米
 *   - solid ：普通赛道地面
 * 视觉（World 的 InstancedMesh）与碰撞（每块一个 cuboid）都读这一份状态。
 */

/** 方格网覆盖的范围：与主赛道地面完全重合（zStart 靠起点、zEnd 靠终点） */
export const TILE_GRID = {
  /** 横向 6 列（赛道 18 m / 3 m） */
  cols: Math.round(TRACK.width / TILE.cellSize),
  /** 20 → -322 共 342 m / 3 m = 114 行 */
  rows: Math.round((TILE.zStart - TILE.zEnd) / TILE.cellSize),
  zStart: TILE.zStart,
  zEnd: TILE.zEnd,
  cell: TILE.cellSize,
  /** 单块尺寸（宽 = 深 = 3 m） */
  width: TRACK.width / Math.round(TRACK.width / TILE.cellSize),
} as const

export type TileRole = 'solid' | 'vanish' | 'bounce'
export type TilePhase = 'idle' | 'tremble' | 'drop' | 'gone' | 'rise' | 'bump'

export interface TileDef {
  id: number
  col: number
  row: number
  x: number
  z: number
  width: number
  depth: number
}

export interface TileVisual {
  /** 竖向偏移（负值 = 已经掉下去 / 还在下面） */
  dropY: number
  /** 掉光之后整块隐身 */
  visible: boolean
  /** 抖动横向偏移（米） */
  shake: number
  /** 回弹压缩量 0..1（0 = 正常，1 = 压到最扁） */
  squash: number
}

/** 碰撞体需要增删的格子（倒塌 / 长回来） */
export interface TileChange {
  index: number
  solid: boolean
}

interface TileState {
  role: TileRole
  phase: TilePhase
  /** 当前相位已进行的时间（秒） */
  t: number
  /** 掉光后还要等多久才回升 */
  wait: number
  /** 回弹格的冷却 */
  cooldown: number
  /** 当前是否有碰撞体 */
  solid: boolean
}

function buildTiles(): TileDef[] {
  const tiles: TileDef[] = []
  const cell = TILE_GRID.cell
  const halfW = TRACK.width / 2
  for (let row = 0; row < TILE_GRID.rows; row++) {
    for (let col = 0; col < TILE_GRID.cols; col++) {
      tiles.push({
        id: tiles.length,
        col,
        row,
        x: -halfW + cell * (col + 0.5),
        z: TILE_GRID.zStart - cell * (row + 0.5),
        width: cell,
        depth: cell,
      })
    }
  }
  return tiles
}

function freshState(role: TileRole, solid = true): TileState {
  return { role, phase: 'idle', t: 0, wait: 0, cooldown: 0, solid }
}

export class TileField {
  readonly tiles: TileDef[] = buildTiles()
  /** 浮桥段被挖空的格子（没有地面、没有碰撞、永远隐身；不参与随机抽签） */
  readonly gap: boolean[] = this.tiles.map(
    (def) => def.z > BRIDGE.gapZEnd && def.z < BRIDGE.gapZStart,
  )
  private readonly states: TileState[]
  /** 每次重排角色都 +1，验收用它确认"每局随机重抽" */
  assignmentId = 0
  /** update() 产生的碰撞变化，给 World 消费 */
  private readonly pending: TileChange[] = []
  /** update() 这一步里"画面需要重写矩阵"的格子（只有动过的那些） */
  readonly touched: number[] = []

  constructor() {
    this.states = this.tiles.map((_, i) => freshState('solid', !this.gap[i]))
    this.reset()
  }

  /** 这一格是不是浮桥挖空段（永远没有地面） */
  isGap(index: number): boolean {
    return this.gap[index] === true
  }

  /** 挖空段的格子下标（验收用） */
  gapIndices(): number[] {
    return this.gap.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
  }

  /**
   * 重排身份（开跑 / 重开一局时调用）。
   * 每格独立随机抽签，整条赛道没有任何"预设的桥段"；
   * 只做两件保底：终点前最后几米永远实心（别让人在终点线上掉下去）、
   * 全局至少各有 6 块消失 / 3 块回弹（极端运气也不会整条路都是实心）。
   * 浮桥挖空段不参与抽签：那一段本来就该是空的。
   */
  reset(rng: () => number = Math.random): void {
    this.assignmentId += 1
    for (let i = 0; i < this.states.length; i++) {
      const st = this.states[i]
      st.role = 'solid'
      st.phase = 'idle'
      st.t = 0
      st.wait = 0
      st.cooldown = 0
      st.solid = !this.gap[i]
    }
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.gap[i]) continue
      const def = this.tiles[i]
      // 终点前 7 m（-313..-320）保持实心：不能在压线那一步掉进虚空
      if (def.z <= TILE.safeFinishZ) continue
      const roll = rng()
      const role: TileRole =
        roll < TILE.vanishChance
          ? 'vanish'
          : roll < TILE.vanishChance + TILE.bounceChance
            ? 'bounce'
            : 'solid'
      this.states[i].role = role
    }
    // 全局保底
    let vanishCnt = 0
    let bounceCnt = 0
    for (const st of this.states) {
      if (st.role === 'vanish') vanishCnt += 1
      else if (st.role === 'bounce') bounceCnt += 1
    }
    const fill = (role: TileRole, need: number): void => {
      for (let k = 0; k < need; k++) {
        const pool = this.tiles.map((_, i) => i).filter((i) => !this.gap[i] && this.states[i].role === 'solid')
        if (pool.length === 0) return
        this.states[pool[Math.floor(rng() * pool.length)]].role = role
      }
    }
    if (vanishCnt < 6) fill('vanish', 6 - vanishCnt)
    if (bounceCnt < 3) fill('bounce', 3 - bounceCnt)
    this.pending.length = 0
    this.touched.length = 0
  }

  /** 调试/验收用：把某一块直接改成指定身份（不改变外观；挖空段不接受修改） */
  setRole(index: number, role: TileRole): boolean {
    const st = this.states[index]
    if (!st || this.gap[index]) return false
    st.role = role
    st.phase = 'idle'
    st.t = 0
    st.wait = 0
    st.cooldown = 0
    st.solid = true
    this.touched.push(index)
    return true
  }

  /** 调试/验收用：把所有格子都变回实心（老回归脚本用它排除随机性；挖空段保持空） */
  clearSpecial(): number {
    let cleared = 0
    for (let i = 0; i < this.states.length; i++) {
      const st = this.states[i]
      if (st.role !== 'solid') {
        st.role = 'solid'
        cleared += 1
      }
      if (st.phase !== 'idle') {
        st.phase = 'idle'
        st.t = 0
        st.wait = 0
      }
      st.cooldown = 0
      if (!st.solid && !this.gap[i]) {
        st.solid = true
        this.pending.push({ index: i, solid: true })
      }
    }
    return cleared
  }

  /** 由世界坐标反查格子下标（不在网格内返回 -1） */
  indexAt(x: number, z: number): number {
    if (z > TILE_GRID.zStart || z < TILE_GRID.zEnd) return -1
    const halfW = TRACK.width / 2
    if (x < -halfW || x > halfW) return -1
    const col = Math.floor((x + halfW) / TILE_GRID.cell)
    const row = Math.floor((TILE_GRID.zStart - z) / TILE_GRID.cell)
    if (col < 0 || col >= TILE_GRID.cols || row < 0 || row >= TILE_GRID.rows) return -1
    return row * TILE_GRID.cols + col
  }

  /**
   * 玩家踩到格子：返回这一格的身份（'vanish' 开始抖、'bounce' 立刻弹）。
   * footY 必须接近地面（站在格子上），空中掠过不触发。
   */
  probe(x: number, z: number, footY: number): 'vanish' | 'bounce' | null {
    if (footY > 0.45 || footY < -0.8) return null
    const i = this.indexAt(x, z)
    if (i < 0 || this.gap[i]) return null
    const st = this.states[i]
    if (!st.solid || st.phase !== 'idle' || st.cooldown > 0) return null
    if (st.role === 'vanish') {
      st.phase = 'tremble'
      st.t = 0
      return 'vanish'
    }
    if (st.role === 'bounce') {
      st.phase = 'bump'
      st.t = 0
      st.cooldown = TILE.bounceCooldown
      return 'bounce'
    }
    return null
  }

  /** 推进状态机，返回本步发生的碰撞体变化（并清空队列） */
  update(dt: number): TileChange[] {
    this.pending.length = 0
    this.touched.length = 0
    for (let i = 0; i < this.states.length; i++) {
      const st = this.states[i]
      // 浮桥挖空段没有格子：状态机永远停在这里，也不产生碰撞变化
      if (this.gap[i]) continue
      if (st.cooldown > 0) st.cooldown = Math.max(0, st.cooldown - dt)
      if (st.phase === 'idle') continue
      // 这一步动过的格子都要重写实例矩阵（包括"刚好回到 idle"的那一帧）
      this.touched.push(i)
      st.t += dt
      switch (st.phase) {
        case 'tremble':
          if (st.t >= TILE.trembleSeconds) {
            st.phase = 'drop'
            st.t = 0
            // 抖动结束的瞬间撤碰撞：人和格子一起往下掉
            if (st.solid) {
              st.solid = false
              this.pending.push({ index: i, solid: false })
            }
          }
          break
        case 'drop':
          if (st.t >= TILE.dropSeconds) {
            st.phase = 'gone'
            st.t = 0
            st.wait = TILE.regrowMin + Math.random() * (TILE.regrowMax - TILE.regrowMin)
          }
          break
        case 'gone':
          st.wait -= dt
          if (st.wait <= 0) {
            st.phase = 'rise'
            st.t = 0
          }
          break
        case 'rise':
          if (st.t >= TILE.riseSeconds) {
            st.phase = 'idle'
            st.t = 0
            if (!st.solid) {
              st.solid = true
              this.pending.push({ index: i, solid: true })
            }
          }
          break
        case 'bump':
          if (st.t >= TILE.bumpSeconds) {
            st.phase = 'idle'
            st.t = 0
          }
          break
      }
    }
    return this.pending
  }

  roleOf(index: number): TileRole {
    return this.states[index].role
  }

  phaseOf(index: number): TilePhase {
    return this.states[index].phase
  }

  /** 视觉参数：抖动 / 下坠 / 长回来 / 压缩；挖空段永远隐身 */
  visual(index: number): TileVisual {
    const st = this.states[index]
    if (this.gap[index]) return { dropY: -TILE.dropDepth, visible: false, shake: 0, squash: 0 }
    switch (st.phase) {
      case 'tremble': {
        const p = st.t / TILE.trembleSeconds
        return { dropY: 0, visible: true, shake: Math.sin(st.t * 46) * 0.05 * (1 - p * 0.3), squash: 0 }
      }
      case 'drop': {
        const p = Math.min(1, st.t / TILE.dropSeconds)
        return { dropY: -TILE.dropDepth * p * p, visible: true, shake: 0, squash: 0 }
      }
      case 'gone':
        return { dropY: -TILE.dropDepth, visible: false, shake: 0, squash: 0 }
      case 'rise': {
        const p = Math.min(1, st.t / TILE.riseSeconds)
        return { dropY: -TILE.dropDepth * (1 - p), visible: true, shake: 0, squash: 0 }
      }
      case 'bump': {
        const p = Math.min(1, st.t / TILE.bumpSeconds)
        return { dropY: 0, visible: true, shake: 0, squash: Math.sin(p * Math.PI) }
      }
      default:
        return { dropY: 0, visible: true, shake: 0, squash: 0 }
    }
  }

  /** 验收快照：每格的坐标 / 身份 / 相位 / 是否有碰撞 / 是否浮桥挖空 */
  snapshot(): Array<{
    index: number
    x: number
    z: number
    col: number
    row: number
    role: TileRole
    phase: TilePhase
    solid: boolean
    gap: boolean
  }> {
    return this.tiles.map((def, i) => ({
      index: i,
      x: def.x,
      z: def.z,
      col: def.col,
      row: def.row,
      role: this.states[i].role,
      phase: this.states[i].phase,
      solid: this.states[i].solid,
      gap: this.gap[i],
    }))
  }
}
