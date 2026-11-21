/**
 * 房间状态仓库：首页 / 大厅 / 游戏三处的共享状态。
 * Vue 响应式只承载"房间级"数据（人数、房主、房间号、榜单），
 * 20 Hz 的位置包不进响应式 —— 那是 Game 内部的事。
 */
import { reactive } from 'vue'
import { RoomClient } from '@/net/RoomClient'
import { recallColor, recallNickname, saveColor, saveNickname } from '@/game/core/Profile'
import {
  defaultRoomUrl,
  MIN_PLAYERS,
  ROOM_CAPACITY,
  type LeaderboardRow,
  type PlayerBrief,
  type ServerEvent,
} from '@/types/network'

export type RoomStatus = 'idle' | 'connecting' | 'lobby' | 'playing'

export const room = reactive({
  status: 'idle' as RoomStatus,
  code: '',
  selfId: '',
  hostId: '',
  capacity: ROOM_CAPACITY,
  minPlayers: MIN_PLAYERS,
  players: [] as PlayerBrief[],
  board: [] as LeaderboardRow[],
  /** 最近一次错误的中文原因，展示在首页/大厅 */
  error: '',
})

export const roomClient = new RoomClient()

let joined = false

type GameHandler = (ev: ServerEvent) => void
const gameHandlers = new Set<GameHandler>()

/** 游戏内事件（位置包、攻击、开跑、榜单）：GameCanvas 订阅后转给 Game */
export function onGameEvent(cb: GameHandler): () => void {
  gameHandlers.add(cb)
  return () => gameHandlers.delete(cb)
}

function resetState(): void {
  room.status = 'idle'
  room.code = ''
  room.selfId = ''
  room.hostId = ''
  room.capacity = ROOM_CAPACITY
  room.players = []
  room.board = []
  joined = false
}

roomClient.onServer((ev) => {
  switch (ev.type) {
    case 'hello':
      room.selfId = ev.id
      break
    case 'room_state':
      room.status = 'lobby'
      room.code = ev.code
      room.hostId = ev.hostId
      room.capacity = ev.capacity
      room.players = ev.players
      joined = true
      room.error = ''
      break
    case 'player_joined':
      if (!room.players.some((p) => p.id === ev.player.id)) room.players = [...room.players, ev.player]
      break
    case 'player_left':
      room.players = room.players.filter((p) => p.id !== ev.playerId)
      break
    case 'countdown':
      // 服务器说开局：直接切到游戏页面，Game 自己接 3 s 倒数
      room.status = 'playing'
      room.board = []
      break
    case 'leaderboard':
      room.board = ev.rows
      break
    case 'error':
      room.error = ev.message
      if (!joined) {
        roomClient.close()
        resetState()
        // 保留错误文案，resetState 不会清它
        room.error = ev.message
      }
      break
    case 'back_to_lobby':
      room.status = 'lobby'
      break
    default:
      break
  }
  for (const h of gameHandlers) h(ev)
})

/** 创建房间：连服务端 → 建房，成功后状态进入 lobby */
export async function createRoom(nickname: string, color: string): Promise<void> {
  resetState()
  room.error = ''
  room.status = 'connecting'
  try {
    await roomClient.connect(defaultRoomUrl())
  } catch (err) {
    room.status = 'idle'
    room.error = err instanceof Error ? err.message : String(err)
    return
  }
  roomClient.send({ type: 'create_room', nickname, color })
}

/** 输入房间号加入 */
export async function joinRoom(code: string, nickname: string, color: string): Promise<void> {
  resetState()
  room.error = ''
  room.status = 'connecting'
  try {
    await roomClient.connect(defaultRoomUrl())
  } catch (err) {
    room.status = 'idle'
    room.error = err instanceof Error ? err.message : String(err)
    return
  }
  roomClient.send({ type: 'join_room', code: code.trim(), nickname, color })
}

export function leaveRoom(): void {
  roomClient.send({ type: 'leave_room' })
  roomClient.close()
  resetState()
}

export function startGame(): void {
  roomClient.send({ type: 'start_game' })
}

/** 多人局结束后回到大厅（重开一局） */
export function backToLobby(): void {
  roomClient.send({ type: 'back_to_lobby' })
  room.status = 'lobby'
}

/** 进直播间后仍要保留的名字与颜色，下次打开自动填好 */
export function rememberIdentity(nickname: string, color: string): void {
  saveNickname(nickname)
  saveColor(color)
}

export function recallIdentity(): { nickname: string; color: string } {
  return { nickname: recallNickname(), color: recallColor() }
}
