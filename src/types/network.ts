/**
 * 网络协议（A-05 冻结）。
 * 规则：任何事件字段变化必须同步更新本文件与 docs/NETWORK_PROTOCOL.md。
 * 设计依据：开发实施说明书 V1.1 §12.1
 */

export const PROTOCOL_VERSION = 1

/** 房间容量：局域网阶段 5，上线阶段 8 */
export const ROOM_CAPACITY = 5

export interface PlayerBrief {
  id: string
  nickname: string
  color: string
  host: boolean
  finished: boolean
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
  /** 动画相位，0–1 */
  a: number
}

export type ClientEvent =
  | { type: 'create_room'; nickname: string; color: string }
  | { type: 'join_room'; code: string; nickname: string; color: string }
  | { type: 'leave_room' }
  | { type: 'start_game' }
  | { type: 'player_state'; payload: PlayerStatePayload }
  | { type: 'checkpoint'; index: number; t: number }
  | { type: 'finish'; t: number }
  | { type: 'ping'; t: number }

export interface LeaderboardRow {
  playerId: string
  nickname: string
  /** 完成时间（服务器毫秒），未完成则为 null */
  timeMs: number | null
  checkpoint: number
  falls: number
}

export type ServerEvent =
  | { type: 'room_state'; code: string; hostId: string; capacity: number; players: PlayerBrief[] }
  | { type: 'player_joined'; player: PlayerBrief }
  | { type: 'player_left'; playerId: string }
  | { type: 'countdown'; startsAt: number; seconds: number }
  | { type: 'game_started'; startsAt: number }
  | { type: 'player_state'; playerId: string; payload: PlayerStatePayload }
  | { type: 'checkpoint_updated'; playerId: string; index: number }
  | { type: 'player_finished'; playerId: string; timeMs: number }
  | { type: 'leaderboard'; rows: LeaderboardRow[] }
  | { type: 'error'; code: string; message: string }

export const ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  GAME_IN_PROGRESS: 'GAME_IN_PROGRESS',
  NOT_HOST: 'NOT_HOST',
  BAD_MESSAGE: 'BAD_MESSAGE',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
