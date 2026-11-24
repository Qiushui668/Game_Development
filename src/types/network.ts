/**
 * 网络协议（阶段 B 局域网联机）。
 * 规则：任何事件字段变化必须同步更新本文件与 docs/NETWORK_PROTOCOL.md。
 * 设计依据：开发实施说明书 V1.1 §12.1；B 阶段容量按用户需求定为 2–8 人。
 */

/** 协议版本：加血量/死亡广播后升到 3；加头顶血条的 hp 字段后升到 4；
 *  加"中途加入 / 全员结算 / 再来一局投票"后升到 5；
 *  加"个人返回大厅（inLobby）"后升到 6，握手不匹配直接拒绝 */
export const PROTOCOL_VERSION = 6

/** 房间容量：局域网 2–8 人（用户指定）；上线阶段沿用 8 */
export const ROOM_CAPACITY = 8
/** 房间最少开跑人数：2 人起，单人请走首页的"单人游戏" */
export const MIN_PLAYERS = 2
/** 房间号长度（纯数字，读音不歧义） */
export const ROOM_CODE_LENGTH = 4

export interface PlayerBrief {
  id: string
  nickname: string
  /** 十六进制色号字符串，如 '#ff3f8b' */
  color: string
  host: boolean
  finished: boolean
  /** 站位序号 0..7：决定起跑线上的位置 */
  slot: number
  /** 中途加入：进来时这一局已经在跑（大厅里的人是 false / 不填） */
  lateJoin?: boolean
  /** 自己点了"返回房间"：这个人已经回大厅，别人还在结算页（投票分母不含他） */
  inLobby?: boolean
  /** 已经点了"再来一局"（结算页回显谁同意了） */
  rematch?: boolean
}

/** 位置同步包：字段名尽量短，20 Hz 下省带宽 */
export interface PlayerStatePayload {
  /** 客户端时间戳（ms） */
  t: number
  /** 位置 x,y,z */
  p: [number, number, number]
  /** 朝向 yaw（弧度） */
  r: number
  /** 状态机状态 */
  s: 'idle' | 'run' | 'jump' | 'fall' | 'knock' | 'respawn' | 'finish'
  /** 速度归一化，0–1（远端用来算跑步动画幅度） */
  a: number
  /** 当前血量（0–100）：远端画在头顶血条上，看到对方的血量 */
  h?: number
}

/** 出手类型 */
export type NetAttackKind = 'light' | 'heavy'

export type ClientEvent =
  | { type: 'create_room'; nickname: string; color: string }
  | { type: 'join_room'; code: string; nickname: string; color: string }
  | { type: 'leave_room' }
  | { type: 'start_game' }
  | { type: 'player_state'; payload: PlayerStatePayload }
  | { type: 'checkpoint'; index: number; t: number }
  | { type: 'finish'; t: number }
  | { type: 'ping'; t: number }
  /** 结算后"自己"回大厅（只影响自己，别人继续留在结算页；房间不关） */
  | { type: 'back_to_lobby' }
  /** 结算面板点"再来一局"：全员都投了票，服务器自动开下一局 */
  | { type: 'rematch' }
  /** 出招动画广播：自己挥了，别人照着播 */
  | { type: 'attack'; kind: NetAttackKind; side: number }
  /** 命中上报：攻击者本地判定打到了谁（客户端权威，局域网熟人局） */
  | { type: 'attack_hit'; targetId: string; kind: NetAttackKind; side: number; x: number; z: number }
  /** 自己血量归零：killerId 为最后一击的来源（障碍/自杀为 null），击杀数由服务器记 */
  | { type: 'died'; killerId: string | null }

export interface LeaderboardRow {
  playerId: string
  nickname: string
  color: string
  /** 完成时间（服务器毫秒），未完成则为 null */
  timeMs: number | null
  checkpoint: number
  falls: number
  /** 本局击杀数 */
  kills: number
  finished: boolean
}

export type ServerEvent =
  /** 握手回执：分配玩家 id 并回显协议版本 */
  | { type: 'hello'; id: string; protocol: number }
  | {
      type: 'room_state'
      code: string
      hostId: string
      capacity: number
      /** 房间当前阶段：大厅 / 倒数 / 比赛中 / 结算 */
      state: RoomPhase
      players: PlayerBrief[]
    }
  | { type: 'player_joined'; player: PlayerBrief }
  | { type: 'player_left'; playerId: string }
  /** 开跑倒数：用相对时长下发，避免两台机器的墙钟偏差 */
  | { type: 'countdown'; seconds: number; startsInMs: number }
  | { type: 'game_started' }
  /** 中途加入：房间已经在跑，补一个"现在跑到哪了"的进度 */
  | { type: 'game_state'; state: RoomPhase; elapsedMs: number }
  | { type: 'player_state'; playerId: string; payload: PlayerStatePayload }
  | { type: 'checkpoint_updated'; playerId: string; index: number }
  | { type: 'player_finished'; playerId: string; timeMs: number }
  | { type: 'leaderboard'; rows: LeaderboardRow[] }
  /** 有人冲线 → 全场立刻弹结算（不必等每个人都跑完） */
  | { type: 'race_over'; rows: LeaderboardRow[]; byPlayerId: string | null }
  /** 再来一局投票进度：votes / total，voterIds 用于回显"谁已经同意了" */
  | { type: 'rematch_status'; votes: number; total: number; voterIds: string[] }
  /** 别人出招：播动画用 */
  | { type: 'attack_played'; playerId: string; kind: NetAttackKind; side: number }
  /** 别人打中了我：本地结算眩晕与答题中断 */
  | { type: 'take_hit'; fromId: string; kind: NetAttackKind; x: number; z: number }
  /** 有人死了：受害者回起点满血；killerId 与自己的 id 相同就记一次击杀 + 播击杀音效 */
  | { type: 'player_died'; playerId: string; killerId: string | null }
  /** 只发给点了「返回房间」的那个人：他也回到大厅了，其他人不受影响 */
  | { type: 'back_to_lobby' }
  /** 本地合成事件（不走服务器）：连接意外断开时由 RoomClient 自己发出 */
  | { type: 'disconnected' }
  | { type: 'error'; code: string; message: string }

/** 房间阶段（与服务器状态机一致） */
export type RoomPhase = 'lobby' | 'countdown' | 'racing' | 'results'

export const ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  GAME_IN_PROGRESS: 'GAME_IN_PROGRESS',
  NOT_HOST: 'NOT_HOST',
  NOT_ENOUGH_PLAYERS: 'NOT_ENOUGH_PLAYERS',
  BAD_MESSAGE: 'BAD_MESSAGE',
  BAD_PROTOCOL: 'BAD_PROTOCOL',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * 房间服务地址（HTTP）。解析顺序：
 * 1. 地址栏 `?room=https://xxx` —— 隧道演示用：隧道地址变了只改链接，不用重新构建；
 * 2. 构建期 `VITE_ROOM_SERVER` —— 前端与房间服务分开部署（Vercel + Render 等）；
 * 3. 页面本身由房间服务同源托管（隧道 / 容器：端口 80/443）→ 直接用同源，`/ws` 自然可达；
 * 4. 局域网开发（Vite 5173 / preview 4173）→ 同主机 :8000。
 */
export function roomServerBase(): string {
  const fromQuery = trimBase(new URLSearchParams(window.location.search).get('room') ?? '')
  if (fromQuery) return fromQuery.replace(/^ws/, 'http')

  const override = (import.meta.env.VITE_ROOM_SERVER as string | undefined)?.trim()
  if (override) return trimBase(override)

  if (!isSeparateDevPort()) {
    return `${window.location.protocol === 'https:' ? 'https' : 'http'}://${window.location.host}`
  }
  const host = window.location.hostname || 'localhost'
  return `${window.location.protocol === 'https:' ? 'https' : 'http'}://${host}:8000`
}

/**
 * WebSocket 地址：同源托管时就是 `wss://<当前页面>/ws`；分开部署时由 `VITE_ROOM_SERVER` 推导。
 * https:// -> wss://、http:// -> ws://（别手工写 ws://，页面是 https 时会被浏览器当混合内容拦掉）。
 */
export function defaultRoomUrl(): string {
  return `${roomServerBase().replace(/^http/, 'ws')}/ws`
}

function trimBase(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/** Vite dev / preview 时页面与房间服务不同端口；其余（隧道、容器、同源部署）视为同源 */
function isSeparateDevPort(): boolean {
  const port = window.location.port
  return port === '5173' || port === '4173'
}

/** 公开房间列表（多人页下方"已有房间"用） */
export interface RoomListItem {
  code: string
  players: number
  capacity: number
  phase: RoomPhase
  host: string
}
