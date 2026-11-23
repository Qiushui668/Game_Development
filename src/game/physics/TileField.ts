import { PLAYER, TILE, TRACK } from '@/game/core/GameConfig'

/**
 * 棋盘方格桥（纯 TS：不 import three、不碰 DOM）。
 * 赛道上挑几段把实心地面换成一块块方格，随机抽成三种角色：
 *   - vanish：踩上去先抖 0.3 s 再掉下去，人跟着掉 → 掉进虚空回起点
 *   - bounce：踩上去立刻把人往 +Z（起点方向）弹回十几米
 *   - solid ：普通格子
 * 视觉（World 的 InstancedMesh）与碰撞（每格一个 cuboid）都读这一份状态。
 */

/** 方格桥区间：zStart 靠起点、zEnd 靠终点（负值，zStart > zEnd） */
export interface TileZoneDef {
  zStart: number
  zEnd: number
}

/** 横向 6 列（赛道 18 m → 每格 3 m），纵向每段 3 行 */
export const TILE_COLS = 6
export const TILE_ROWS = 3

/**
 * 三段方格桥都卡在「身后 12 m 没有任何实体障碍」的空档里：
 * 回弹是往 +Z（起点方向）弹，如果桥后紧贴栏架，人会被栏架挡在 3–4 m 处，
 * 弹不到"十几米"。下面三段的后退落点都在空格里（只有无碰撞的地刺/滚轴/摆锤）。
 */
export const TILE_ZONES: TileZoneDef[] = [
  { zStart: -47.7, zEnd: -56.3 },
  { zStart: -239.7, zEnd: -248.9 },
  { zStart: -263, zEnd: -272 },
]

export type TileRole = 'solid' | 'vanish' | 'bounce'
export type TilePhase = 'idle' | 'tremble' | 'drop' | 'gone' | 'rise' | 'bump'

export interface TileDef {
  id: number
  /** 所属区间下标 */
  zone: number
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
  const width = TRACK.width / TILE_COLS
  TILE_ZONES.forEach((zone, zi) => {
    const depth = (zone.zStart - zone.zEnd) / TILE_ROWS
    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        tiles.push({
          id: tiles.length,
          zone: zi,
          col,
          row,
          x: -TRACK.width / 2 + width * (col + 0.5),
          z: zone.zStart - depth * (row + 0.5),
          width,
          depth,
        })
      }
    }
  })
  return tiles
}

function freshState(role: TileRole): TileState {
  return { role, phase: 'idle', t: 0, wait: 0, cooldown: 0, solid: true }
}

export class TileField {
  readonly tiles: TileDef[] = buildTiles()
  private readonly states: TileState[]
  /** 每次重排角色都 +1，验收用它确认"每局随机重抽" */
  assignmentId = 0
  /** update() 产生的碰撞变化，给 World 消费 */
  private readonly pending: TileChange[] = []

  constructor() {
    this.states = this.tiles.map(() => freshState('solid'))
    this.reset()
  }

  /**
   * 重排角色（开跑 / 重开一局时调用）。
   * 每格独立随机，但每个区间至少保底 2 块消失、1 块回弹，避免整段全是实心。
   */
  reset(rng: () => number = Math.random): void {
    this.assignmentId += 1
    for (const st of this.states) {
      st.role = 'solid'
      st.phase = 'idle'
      st.t = 0
      st.wait = 0
      st.cooldown = 0
      st.solid = true
    }
    for (let i = 0; i < this.tiles.length; i++) {
      const roll = rng()
      const role: TileRole =
        roll < TILE.vanishChance ? 'vanish' : roll < TILE.vanishChance + TILE.bounceChance ? 'bounce' : 'solid'
      this.states[i].role = role
    }
    // 保底：按区间补齐消失格与回弹格
    for (let zone = 0; zone < TILE_ZONES.length; zone++) {
      const idx = this.states.map((s, i) => ({ s, i })).filter((e) => this.tiles[e.i].zone === zone)
      const vanishCnt = idx.filter((e) => e.s.role === 'vanish').length
      const bounceCnt = idx.filter((e) => e.s.role === 'bounce').length
      for (let need = vanishCnt; need < 2; need++) {
        const pool = idx.filter((e) => e.s.role === 'solid')
        if (pool.length === 0) break
        pool[Math.floor(rng() * pool.length)].s.role = 'vanish'
      }
      if (bounceCnt === 0) {
        const pool = idx.filter((e) => e.s.role === 'solid')
        if (pool.length > 0) pool[Math.floor(rng() * pool.length)].s.role = 'bounce'
      }
    }
    this.pending.length = 0
  }

  /**
   * 玩家踩到格子：返回这一格的角色事件（'vanish' 开始抖、'bounce' 立刻弹）。
   * footY 必须接近地面（站在格子上），空中掠过不触发。
   */
  probe(x: number, z: number, footY: number): 'vanish' | 'bounce' | null {
    if (footY > 0.45 || footY < -0.8) return null
    const reach = PLAYER.radius * 0.7
    for (let i = 0; i < this.tiles.length; i++) {
      const def = this.tiles[i]
      if (Math.abs(x - def.x) > def.width / 2 + reach) continue
      if (Math.abs(z - def.z) > def.depth / 2 + reach) continue
      const st = this.states[i]
      if (!st.solid || st.phase !== 'idle' || st.cooldown > 0) continue
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
    }
    return null
  }

  /** 推进状态机，返回本步发生的碰撞体变化（并清空队列） */
  update(dt: number): TileChange[] {
    this.pending.length = 0
    for (let i = 0; i < this.states.length; i++) {
      const st = this.states[i]
      if (st.cooldown > 0) st.cooldown = Math.max(0, st.cooldown - dt)
      if (st.phase === 'idle') continue
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

  /** 视觉参数：抖动 / 下坠 / 长回来 / 压缩 */
  visual(index: number): TileVisual {
    const st = this.states[index]
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

  /** 验收快照：每格的坐标 / 角色 / 相位 / 是否有碰撞 */
  snapshot(): Array<{
    index: number
    zone: number
    x: number
    z: number
    role: TileRole
    phase: TilePhase
    solid: boolean
  }> {
    return this.tiles.map((def, i) => ({
      index: i,
      zone: def.zone,
      x: def.x,
      z: def.z,
      role: this.states[i].role,
      phase: this.states[i].phase,
      solid: this.states[i].solid,
    }))
  }
}
