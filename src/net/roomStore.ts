/**
 * 房间状态仓库：首页 / 大厅 / 游戏三处的共享状态。
 * Vue 响应式只承载"房间级"数据（人数、房主、房间号、榜单、结算与投票），
 * 20 Hz 的位置包不进响应式 —— 那是 Game 内部的事。
 */
import { reactive } from 'vue'
import { RoomClient } from '@/net/RoomClient'
import { recallColor, recallNickname, saveColor, saveNickname } from '@/game/core/Profile'
import {
  defaultRoomUrl,
  MIN_PLAYERS,
  ROOM_CAPACITY,
  roomServerBase,
  type LeaderboardRow,
  type PlayerBrief,
  type RoomListItem,
  type RoomPhase,
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
  /** 服务器状态机：大厅 / 倒数 / 比赛中 / 结算 */
  phase: 'lobby' as RoomPhase,
  /** 本局是否已经结束（有人冲线，全员看结算） */
  raceOver: false,
  /** 再来一局投票进度 */
  rematchVotes: 0,
  rematchTotal: 0,
  rematchVoterIds: [] as string[],
  /** 自己是不是中途加入的（进来时这局已经在跑） */
  lateJoin: false,
  /** 最近一次错误的中文原因，展示在首页/大厅 */
  error: '',
})

export const roomClient = new RoomClient()

/** 多人页下方的"已有房间"列表 */
export const roomList = reactive({
  items: [] as RoomListItem[],
  loaded: false,
  loading: false,
  error: '',
})

let joined = false

type GameHandler = (ev: ServerEvent) => void
const gameHandlers = new Set<GameHandler>()

/** 游戏内事件（位置包、攻击、开跑、榜单、结算）：GameCanvas 订阅后转给 Game */
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
  room.phase = 'lobby'
  room.raceOver = false
  room.rematchVotes = 0
  room.rematchTotal = 0
  room.rematchVoterIds = []
  room.lateJoin = false
  joined = false
}

function clearRound(): void {
  room.board = []
  room.raceOver = false
  room.rematchVotes = 0
  room.rematchTotal = 0
  room.rematchVoterIds = []
}

roomClient.onServer((ev) => {
  switch (ev.type) {
    case 'hello':
      room.selfId = ev.id
      break
    case 'room_state':
      // 关键：只有大厅阶段才回到首页；racing / countdown / results 都留在游戏里
      room.status = ev.state === 'lobby' ? 'lobby' : 'playing'
      room.phase = ev.state
      room.code = ev.code
      room.hostId = ev.hostId
      room.capacity = ev.capacity
      room.players = ev.players
      joined = true
      room.error = ''
      break
    case 'player_joined':
      room.players = [...room.players.filter((p) => p.id !== ev.player.id), ev.player]
      if (ev.player.id === room.selfId && ev.player.lateJoin) room.lateJoin = true
      break
    case 'player_left':
      room.players = room.players.filter((p) => p.id !== ev.playerId)
      break
    case 'countdown':
      // 服务器说开局（首次开跑或"再来一局"通过）：切到游戏页面，Game 自己接 3 s 倒数
      room.status = 'playing'
      clearRound()
      break
    case 'game_state':
      // 中途加入：这局已经在跑，直接进游戏，跟着一起跑
      room.status = 'playing'
      room.phase = ev.state
      room.lateJoin = true
      clearRound()
      break
    case 'race_over':
      room.board = ev.rows
      room.raceOver = true
      room.phase = 'results'
      break
    case 'rematch_status':
      room.rematchVotes = ev.votes
      room.rematchTotal = ev.total
      room.rematchVoterIds = ev.voterIds
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
      room.phase = 'lobby'
      clearRound()
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

/** 输入房间号加入（也用于点房间列表直接加入；比赛中也能进，满 8 人拒绝） */
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

/** 结算面板点"返回房间"：所有人回大厅（不关房间） */
export function backToLobby(): void {
  roomClient.send({ type: 'back_to_lobby' })
  room.status = 'lobby'
  room.phase = 'lobby'
  clearRound()
}

/** 结算面板点"再来一局"：全员都投了票，服务器自动开下一局 */
export function voteRematch(): void {
  roomClient.send({ type: 'rematch' })
}

/** 拉取服务端的公开房间列表（多人页下方展示，点了就能加入） */
export async function refreshRooms(): Promise<void> {
  roomList.loading = true
  try {
    const res = await fetch(`${roomServerBase()}/rooms`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`房间列表返回 ${res.status}`)
    const data = (await res.json()) as { rooms: RoomListItem[] }
    roomList.items = Array.isArray(data.rooms) ? data.rooms : []
    roomList.error = ''
    roomList.loaded = true
  } catch (err) {
    roomList.error = err instanceof Error ? err.message : String(err)
  } finally {
    roomList.loading = false
  }
}

/** 记住名字与颜色（昵称带 1 小时时效，见 Profile） */
export function rememberIdentity(nickname: string, color: string): void {
  saveNickname(nickname)
  saveColor(color)
}

export function recallIdentity(): { nickname: string; color: string } {
  return { nickname: recallNickname(), color: recallColor() }
}
