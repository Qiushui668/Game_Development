/**
 * 网络协议（阶段 B 局域网联机）。
 * 规则：任何事件字段变化必须同步更新本文件与 docs/NETWORK_PROTOCOL.md。
 * 设计依据：开发实施说明书 V1.1 §12.1；B 阶段容量按用户需求定为 2–8 人。
 */

/** 协议版本：加攻击同步与 hello 后升到 2，握手不匹配直接拒绝 */
export const PROTOCOL_VERSION = 2

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
  /** 结算后回大厅，所有人回到房间等待下一局（房主也能重开） */
  | { type: 'back_to_lobby' }
  /** 出招动画广播：自己挥了，别人照着播 */
  | { type: 'attack'; kind: NetAttackKind; side: number }
  /** 命中上报：攻击者本地判定打到了谁（客户端权威，局域网熟人局） */
  | { type: 'attack_hit'; targetId: string; kind: NetAttackKind; side: number; x: number; z: number }

export interface LeaderboardRow {
  playerId: string
  nickname: string
  color: string
  /** 完成时间（服务器毫秒），未完成则为 null */
  timeMs: number | null
  checkpoint: number
  falls: number
  finished: boolean
}

export type ServerEvent =
  /** 握手回执：分配玩家 id 并回显协议版本 */
  | { type: 'hello'; id: string; protocol: number }
  | { type: 'room_state'; code: string; hostId: string; capacity: number; players: PlayerBrief[] }
  | { type: 'player_joined'; player: PlayerBrief }
  | { type: 'player_left'; playerId: string }
  /** 开跑倒数：用相对时长下发，避免两台机器的墙钟偏差 */
  | { type: 'countdown'; seconds: number; startsInMs: number }
  | { type: 'game_started' }
  | { type: 'player_state'; playerId: string; payload: PlayerStatePayload }
  | { type: 'checkpoint_updated'; playerId: string; index: number }
  | { type: 'player_finished'; playerId: string; timeMs: number }
  | { type: 'leaderboard'; rows: LeaderboardRow[] }
  /** 别人出招：播动画用 */
  | { type: 'attack_played'; playerId: string; kind: NetAttackKind; side: number }
  /** 别人打中了我：本地结算眩晕与答题中断 */
  | { type: 'take_hit'; fromId: string; kind: NetAttackKind; x: number; z: number }
  | { type: 'back_to_lobby' }
  | { type: 'error'; code: string; message: string }

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

/** 房间服务端默认地址：与页面同主机，端口 8000 */
export function defaultRoomUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.hostname || 'localhost'
  return `${proto}://${host}:8000/ws`
}
