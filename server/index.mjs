/**
 * 局域网房间服务端（阶段 B）。
 * 职责只有四件：房间（建/加/退/中途加入、容量 2–8、房主转移、公开房间列表）、
 * 中继（20 Hz player_state、攻击事件）、裁判（服务器单调时钟算完赛时间）、
 * 流程（全员结算 + 再来一局投票）。
 *
 * 不做物理模拟、不做反作弊 —— 与 docs/NETWORK_PROTOCOL.md 的权限模型一致。
 * 启动：node server/index.mjs（默认 0.0.0.0:8000，HTTP 端点 /health、/rooms，WS 端点 /ws）
 */
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT ?? 8000)
const HOST = process.env.HOST ?? '0.0.0.0'
const CAPACITY = 8
const MIN_PLAYERS = 2
const PROTOCOL_VERSION = 5
const COUNTDOWN_MS = 3000
const KNOCKDOWN_SECONDS = 1

/** @type {Map<string, Room>} */
const rooms = new Map()
let nextId = 0

function newId() {
  nextId += 1
  return `p${nextId}`
}

function makeCode() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const code = String(1000 + Math.floor(Math.random() * 9000))
    if (!rooms.has(code)) return code
  }
  return null
}

function cleanNickname(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, 12)
  return trimmed.length > 0 ? trimmed : null
}

/** 与前端 CROWD_COLORS 前 8 个一致：没选配色（或传了非法值）的玩家由服务器随机分一个 */
const CROWD_HEX = ['#ff3f8b', '#22d0c8', '#7a5cff', '#35e07a', '#ff8a3d', '#3fb6ff', '#ffd23f', '#d24bff']

function cleanColor(raw) {
  if (typeof raw === 'string') {
    const m = /^#[0-9a-fA-F]{6}$/.exec(raw.trim())
    if (m) return m[0].toLowerCase()
  }
  // 随机一次并写进这份成员数据：之后所有人（含本人）读到的都是这一个颜色
  return CROWD_HEX[Math.floor(Math.random() * CROWD_HEX.length)]
}

/** @typedef {{ id: string, nickname: string, color: string, ws: import('ws').WebSocket, slot: number, joinedAt: number, finished: boolean, timeMs: number | null, checkpoint: number, falls: number, kills: number, rematch: boolean, lateJoin: boolean, inLobby: boolean }} Member */
/** @typedef {'lobby'|'countdown'|'racing'|'results'} RoomPhase */
/** @typedef {{ code: string, hostId: string, state: RoomPhase, members: Member[], raceStartAt: number, countdownTimer: ReturnType<typeof setTimeout> | null }} Room */

function roomPlayers(room) {
  return room.members.map((m) => ({
    id: m.id,
    nickname: m.nickname,
    color: m.color,
    host: m.id === room.hostId,
    finished: m.finished,
    slot: m.slot,
    /** 中途加入的人：客户端据此知道他没跑前半程 */
    lateJoin: m.lateJoin,
    /** 自己点了「返回房间」：只有他回大厅，别人还在结算/跑图 */
    inLobby: m.inLobby,
  }))
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}

function broadcast(room, msg, exceptWs = null) {
  const raw = JSON.stringify(msg)
  for (const m of room.members) {
    if (m.ws === exceptWs) continue
    if (m.ws.readyState === 1) m.ws.send(raw)
  }
}

function broadcastRoomState(room) {
  broadcast(room, {
    type: 'room_state',
    code: room.code,
    hostId: room.hostId,
    capacity: CAPACITY,
    state: room.state,
    players: roomPlayers(room),
  })
}

/** 公开给"已有房间"列表用的精简信息（不暴露 ws / 内部字段） */
function roomBrief(room) {
  const host = room.members.find((m) => m.id === room.hostId)
  return {
    code: room.code,
    players: room.members.length,
    capacity: CAPACITY,
    phase: room.state,
    host: host ? host.nickname : '—',
  }
}

function publicRooms() {
  return [...rooms.values()]
    .filter((r) => r.members.length > 0)
    .map(roomBrief)
    .sort((a, b) => a.code.localeCompare(b.code))
}

/** 重新排站位：按入房先后，0 起，客户端据此算起跑线 X */
function relayout(room) {
  room.members.forEach((m, i) => {
    m.slot = i
  })
}

function leaderboard(room) {
  return room.members
    .map((m) => ({
      playerId: m.id,
      nickname: m.nickname,
      color: m.color,
      timeMs: m.timeMs,
      checkpoint: m.checkpoint,
      falls: m.falls,
      kills: m.kills,
      finished: m.finished,
    }))
    .sort((a, b) => {
      if (a.timeMs === null && b.timeMs === null) return a.nickname.localeCompare(b.nickname)
      if (a.timeMs === null) return 1
      if (b.timeMs === null) return -1
      return a.timeMs - b.timeMs
    })
}

function resetMemberStats(room) {
  for (const m of room.members) {
    m.finished = false
    m.timeMs = null
    m.checkpoint = -1
    m.falls = 0
    m.kills = 0
    m.rematch = false
  }
}

function fail(ws, code, message) {
  send(ws, { type: 'error', code, message })
}

/**
 * 有人离开 / 掉线。
 * 关键：**不再把房间状态打回大厅**，也不广播 back_to_lobby —— 其他人正在跑的那局继续跑；
 * 只有"人走光了"才解散房间，倒数阶段只要还剩人就照常开跑。
 */
function leaveRoom(session) {
  const room = session.room
  if (!room) return
  const member = room.members.find((m) => m.id === session.id)
  session.room = null
  room.members = room.members.filter((m) => m.id !== session.id)
  if (room.members.length === 0) {
    if (room.countdownTimer) {
      clearTimeout(room.countdownTimer)
      room.countdownTimer = null
    }
    rooms.delete(room.code)
    console.log(`[room] ${room.code} 解散`)
    return
  }
  if (room.hostId === session.id) {
    room.hostId = room.members[0].id
    console.log(`[room] ${room.code} 房主转给 ${room.members[0].nickname}`)
  }
  relayout(room)
  broadcast(room, { type: 'player_left', playerId: session.id })
  broadcastRoomState(room)
  // 结算阶段有人走：如果剩下的人都投了"再来一局"，那就直接开
  if (room.state === 'results' && everyoneWantsRematch(room)) startGame(room)
  console.log(
    `[room] ${room.code} ${member ? member.nickname : session.id} 离开，剩 ${room.members.length} 人（状态 ${room.state}）`,
  )
}

function joinCommon(session, room, nickname, color) {
  const member = {
    id: session.id,
    nickname,
    color,
    ws: session.ws,
    slot: 0,
    joinedAt: performance.now(),
    finished: false,
    timeMs: null,
    checkpoint: -1,
    falls: 0,
    kills: 0,
    rematch: false,
    /** 中途加入：进来时这局已经跑了一段 */
    lateJoin: room.state === 'racing' || room.state === 'countdown',
    /** 结算阶段进房的人先待在大厅，等下一局自动带上 */
    inLobby: room.state === 'results',
  }
  room.members.push(member)
  session.room = room
  relayout(room)
  // 给新人自己：完整房间状态
  send(session.ws, {
    type: 'room_state',
    code: room.code,
    hostId: room.hostId,
    capacity: CAPACITY,
    state: room.state,
    players: roomPlayers(room),
  })
  // 如果这局已经在跑，把"跑到哪了"告诉新人（客户端据此直接进入比赛）
  if (room.state === 'racing' || room.state === 'countdown') {
    const elapsedMs = room.raceStartAt > 0 ? performance.now() - room.raceStartAt : 0
    send(session.ws, { type: 'game_state', state: room.state, elapsedMs: Math.round(elapsedMs) })
  }
  // 给老玩家：有人来了（含中途加入），客户端据此新增一个远端果冻人
  broadcast(room, { type: 'player_joined', player: roomPlayers(room).find((p) => p.id === member.id) }, session.ws)
  broadcastRoomState(room)
  console.log(
    `[room] ${room.code} ${nickname}(${member.id}) 加入，共 ${room.members.length} 人${member.lateJoin ? '（中途加入）' : ''}`,
  )
  return member
}

/**
 * 全员都同意"再来一局"？
 * **只统计还在结算页的人**：已经点了「返回房间」回大厅的人（inLobby）不投票、也不计入分母，
 * 免得一个人回了大厅就把整局卡死。开下一局时会把大厅里的人一起带上。
 */
function everyoneWantsRematch(room) {
  const voting = room.members.filter((m) => !m.inLobby)
  return voting.length > 0 && voting.every((m) => m.rematch)
}

/** 广播再来一局投票进度（分母只算还在结算页的人） */
function broadcastRematchStatus(room) {
  const voting = room.members.filter((m) => !m.inLobby)
  broadcast(room, {
    type: 'rematch_status',
    votes: voting.filter((m) => m.rematch).length,
    total: voting.length,
    voterIds: voting.filter((m) => m.rematch).map((m) => m.id),
  })
}

/**
 * 开一局：lobby / results 都能开。
 * results 开下一局就是"再来一局"投票全通过后的自动开局。
 * 开局时把所有人（包括点了「返回房间」待在大厅的人）一起拉回赛道。
 */
function startGame(room) {
  if (room.state === 'countdown' || room.state === 'racing') return
  room.state = 'countdown'
  room.raceStartAt = 0
  resetMemberStats(room)
  for (const m of room.members) m.inLobby = false
  broadcast(room, { type: 'countdown', seconds: COUNTDOWN_MS / 1000, startsInMs: COUNTDOWN_MS })
  if (room.countdownTimer) clearTimeout(room.countdownTimer)
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null
    if (room.members.length === 0) return
    room.state = 'racing'
    room.raceStartAt = performance.now()
    broadcast(room, { type: 'game_started' })
    broadcastRoomState(room)
    console.log(`[room] ${room.code} 开跑，${room.members.length} 人`)
  }, COUNTDOWN_MS)
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        rooms: rooms.size,
        players: [...rooms.values()].reduce((n, r) => n + r.members.length, 0),
      }),
    )
    return
  }
  if (req.url === '/rooms') {
    const body = JSON.stringify({ rooms: publicRooms() })
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    })
    res.end(body)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('PY Party Run room server\n联机请连 /ws，房间列表见 /rooms')
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  const session = { id: newId(), ws, room: null }
  ws.isAlive = true
  ws.on('pong', () => {
    ws.isAlive = true
  })
  send(ws, { type: 'hello', id: session.id, protocol: PROTOCOL_VERSION })

  ws.on('message', (data) => {
    let msg
    try {
      msg = JSON.parse(String(data))
    } catch {
      fail(ws, 'BAD_MESSAGE', '不是合法 JSON')
      return
    }
    if (!msg || typeof msg.type !== 'string') {
      fail(ws, 'BAD_MESSAGE', '缺少 type')
      return
    }
    handle(session, msg)
  })

  ws.on('close', () => leaveRoom(session))
  ws.on('error', () => leaveRoom(session))
})

/** @param {any} session @param {any} msg */
function handle(session, msg) {
  const { ws } = session

  if (msg.type === 'ping') {
    send(ws, { type: 'pong', t: msg.t })
    return
  }

  if (msg.type === 'create_room') {
    if (session.room) return fail(ws, 'BAD_MESSAGE', '已经在房间里')
    const nickname = cleanNickname(msg.nickname)
    if (!nickname) return fail(ws, 'BAD_MESSAGE', '昵称不能为空')
    const code = makeCode()
    if (!code) return fail(ws, 'ROOM_FULL', '房间号已用尽')
    /** @type {Room} */
    const room = {
      code,
      hostId: session.id,
      state: 'lobby',
      members: [],
      raceStartAt: 0,
      countdownTimer: null,
    }
    rooms.set(code, room)
    joinCommon(session, room, nickname, cleanColor(msg.color))
    console.log(`[room] ${code} 创建`)
    return
  }

  if (msg.type === 'join_room') {
    if (session.room) return fail(ws, 'BAD_MESSAGE', '已经在房间里')
    const code = typeof msg.code === 'string' ? msg.code.trim() : ''
    const room = rooms.get(code)
    if (!room) return fail(ws, 'ROOM_NOT_FOUND', `房间 ${code || '?'} 不存在`)
    // 满员优先判断：中途加入也卡 8 人上限
    if (room.members.length >= CAPACITY) return fail(ws, 'ROOM_FULL', `房间已满（${CAPACITY} 人），等有人退出再来`)
    const nickname = cleanNickname(msg.nickname)
    if (!nickname) return fail(ws, 'BAD_MESSAGE', '昵称不能为空')
    // 比赛中（countdown / racing）也允许加入，进来跟着一起跑（进度从起点算）
    joinCommon(session, room, nickname, cleanColor(msg.color))
    return
  }

  const room = session.room
  if (!room) return fail(ws, 'BAD_MESSAGE', '先建房或进房')

  if (msg.type === 'leave_room') {
    leaveRoom(session)
    return
  }

  if (msg.type === 'start_game') {
    if (room.hostId !== session.id) return fail(ws, 'NOT_HOST', '只有房主能开跑')
    if (room.state === 'countdown' || room.state === 'racing') return fail(ws, 'BAD_MESSAGE', '这局已经在跑了')
    if (room.members.length < MIN_PLAYERS) {
      return fail(ws, 'NOT_ENOUGH_PLAYERS', `至少要 ${MIN_PLAYERS} 人才能开跑`)
    }
    startGame(room)
    return
  }

  if (msg.type === 'rematch') {
    if (room.state !== 'results') return fail(ws, 'BAD_MESSAGE', '这一局还没结束')
    const member = room.members.find((m) => m.id === session.id)
    if (!member) return
    if (member.inLobby) return fail(ws, 'BAD_MESSAGE', '你已经回房间大厅了，等下一局一起跑')
    member.rematch = true
    broadcastRematchStatus(room)
    const voting = room.members.filter((m) => !m.inLobby)
    console.log(
      `[room] ${room.code} ${member.nickname} 投了再来一局（${voting.filter((m) => m.rematch).length}/${voting.length}）`,
    )
    // 还在结算页的人都投了 → 自动开下一局（不再需要房主点开始）
    if (everyoneWantsRematch(room)) {
      console.log(`[room] ${room.code} 结算页全员同意再来一局，自动开下一局`)
      startGame(room)
    }
    return
  }

  /**
   * 结算页「返回房间」：**只把自己送回大厅**，别人的结算页照旧、比赛不打断。
   * 点了返回的人不参与这轮投票（分母把他剔掉），开下一局时再一起拉回赛道。
   * 如果房间里所有人都回了大厅，才把整房状态落回 lobby。
   */
  if (msg.type === 'back_to_lobby') {
    const member = room.members.find((m) => m.id === session.id)
    if (!member) return
    if (room.state === 'countdown' || room.state === 'racing') {
      return fail(ws, 'BAD_MESSAGE', '这局还在跑，等结算再回大厅')
    }
    member.inLobby = true
    member.rematch = false
    send(member.ws, { type: 'back_to_lobby' })
    console.log(`[room] ${room.code} ${member.nickname} 自己回了大厅（其他人留在结算页）`)

    if (room.members.every((m) => m.inLobby)) {
      // 都回大厅了：把房间状态落回 lobby，谁都能重新开
      room.state = 'lobby'
      resetMemberStats(room)
      for (const m of room.members) m.rematch = false
    }
    broadcastRoomState(room)
    broadcastRematchStatus(room)
    // 走了一个投票人，剩下的人可能已经全票 → 直接开
    if (room.state === 'results' && everyoneWantsRematch(room)) startGame(room)
    return
  }

  if (msg.type === 'player_state') {
    if (room.state !== 'racing' && room.state !== 'results') return
    const payload = msg.payload
    if (!payload || !Array.isArray(payload.p) || payload.p.length !== 3) return
    broadcast(room, { type: 'player_state', playerId: session.id, payload }, ws)
    return
  }

  if (msg.type === 'attack') {
    if (room.state !== 'racing') return
    if (msg.kind !== 'light' && msg.kind !== 'heavy') return
    broadcast(room, { type: 'attack_played', playerId: session.id, kind: msg.kind, side: msg.side === -1 ? -1 : 1 }, ws)
    return
  }

  if (msg.type === 'attack_hit') {
    if (room.state !== 'racing') return
    if (msg.kind !== 'light' && msg.kind !== 'heavy') return
    const target = room.members.find((m) => m.id === msg.targetId)
    if (!target || target.id === session.id) return
    send(target.ws, {
      type: 'take_hit',
      fromId: session.id,
      kind: msg.kind,
      x: typeof msg.x === 'number' ? msg.x : 0,
      z: typeof msg.z === 'number' ? msg.z : 0,
    })
    return
  }

  if (msg.type === 'died') {
    if (room.state !== 'racing' && room.state !== 'results') return
    const victim = room.members.find((m) => m.id === session.id)
    if (!victim) return
    // killerId 必须指向本房间里的另一个人，否则按"被障碍/自己搞死"处理
    const killer =
      typeof msg.killerId === 'string' && msg.killerId !== session.id
        ? room.members.find((m) => m.id === msg.killerId) ?? null
        : null
    if (killer) killer.kills += 1
    // 全场广播（含自己）：击杀者在客户端据此 +1 并播 1杀.mp3
    broadcast(room, {
      type: 'player_died',
      playerId: victim.id,
      killerId: killer ? killer.id : null,
    })
    if (killer) {
      console.log(`[room] ${room.code} ${killer.nickname} 击杀 ${victim.nickname}（累计 ${killer.kills}）`)
    }
    broadcast(room, { type: 'leaderboard', rows: leaderboard(room) })
    return
  }

  if (msg.type === 'checkpoint') {
    if (room.state !== 'racing') return
    const member = room.members.find((m) => m.id === session.id)
    if (!member) return
    const index = Number(msg.index)
    if (!Number.isInteger(index) || index <= member.checkpoint) return
    member.checkpoint = index
    send(ws, { type: 'checkpoint_updated', playerId: session.id, index })
    return
  }

  if (msg.type === 'finish') {
    if (room.state !== 'racing') return
    const member = room.members.find((m) => m.id === session.id)
    if (!member || member.finished) return
    member.finished = true
    member.timeMs = Math.max(0, Math.round(performance.now() - room.raceStartAt))
    broadcast(room, { type: 'player_finished', playerId: member.id, timeMs: member.timeMs })
    broadcast(room, { type: 'leaderboard', rows: leaderboard(room) })
    console.log(`[room] ${room.code} ${member.nickname} 完赛 ${member.timeMs} ms`)
    // 第一个人冲线 → 全场立刻结算（没跑完的人一起看到结算面板）
    room.state = 'results'
    for (const m of room.members) m.rematch = false
    broadcast(room, { type: 'race_over', rows: leaderboard(room), byPlayerId: member.id })
    broadcastRoomState(room)
    console.log(`[room] ${room.code} 进入结算（首位 ${member.nickname}）`)
    return
  }
}

/** 心跳：30 s 一轮，断网/关页面 60 s 内能清出房间 */
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    ws.ping()
  }
}, 30000)
wss.on('close', () => clearInterval(heartbeat))

server.listen(PORT, HOST, () => {
  console.log(`[server] 房间服务已启动 ws://${HOST}:${PORT}/ws  容量 ${MIN_PLAYERS}-${CAPACITY} 人  v${PROTOCOL_VERSION}`)
  console.log(`[server] 眩晕规则：轻击 3 次 / 重击 1 次倒地 ${KNOCKDOWN_SECONDS} s（由客户端结算）`)
  console.log(`[server] 支持中途加入（≤${CAPACITY} 人）、全员结算、再来一局投票；房间列表 GET /rooms`)
})
