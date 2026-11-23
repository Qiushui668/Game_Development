/**
 * 局域网房间服务端（阶段 B）。
 * 职责只有三件：房间（建/加/退、容量 2–8、房主转移）、中继（20 Hz player_state、攻击事件）、
 * 裁判（服务器单调时钟算完赛时间、校验 checkpoint 递增）。
 *
 * 不做物理模拟、不做反作弊 —— 与 docs/NETWORK_PROTOCOL.md 的权限模型一致。
 * 启动：node server/index.mjs（默认 0.0.0.0:8000，端点 /ws）
 */
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT ?? 8000)
const HOST = process.env.HOST ?? '0.0.0.0'
const CAPACITY = 8
const MIN_PLAYERS = 2
const PROTOCOL_VERSION = 4
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

function cleanColor(raw) {
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  return '#ff3f8b'
}

/** @typedef {{ id: string, nickname: string, color: string, ws: import('ws').WebSocket, slot: number, joinedAt: number, finished: boolean, timeMs: number | null, checkpoint: number, falls: number, kills: number }} Member */
/** @typedef {{ code: string, hostId: string, state: 'lobby' | 'countdown' | 'racing', members: Member[], raceStartAt: number, countdownTimer: ReturnType<typeof setTimeout> | null }} Room */

function roomPlayers(room) {
  return room.members.map((m) => ({
    id: m.id,
    nickname: m.nickname,
    color: m.color,
    host: m.id === room.hostId,
    finished: m.finished,
    slot: m.slot,
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
    players: roomPlayers(room),
  })
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

function fail(ws, code, message) {
  send(ws, { type: 'error', code, message })
}

function leaveRoom(session) {
  const room = session.room
  if (!room) return
  session.room = null
  room.members = room.members.filter((m) => m.id !== session.id)
  if (room.state !== 'lobby' && room.countdownTimer) {
    clearTimeout(room.countdownTimer)
    room.countdownTimer = null
    room.state = 'lobby'
  }
  if (room.members.length === 0) {
    rooms.delete(room.code)
    console.log(`[room] ${room.code} 解散`)
    return
  }
  if (room.hostId === session.id) room.hostId = room.members[0].id
  relayout(room)
  broadcast(room, { type: 'player_left', playerId: session.id })
  broadcastRoomState(room)
  console.log(`[room] ${room.code} ${session.id} 离开，剩 ${room.members.length} 人`)
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
  }
  room.members.push(member)
  session.room = room
  relayout(room)
  send(session.ws, { type: 'room_state', code: room.code, hostId: room.hostId, capacity: CAPACITY, players: roomPlayers(room) })
  for (const m of room.members) {
    if (m.id === member.id) continue
    if (m.ws.readyState === 1) {
      m.ws.send(JSON.stringify({ type: 'room_state', code: room.code, hostId: room.hostId, capacity: CAPACITY, players: roomPlayers(room) }))
    }
  }
  console.log(`[room] ${room.code} ${nickname}(${member.id}) 加入，共 ${room.members.length} 人`)
  return member
}

function startGame(room) {
  if (room.state !== 'lobby') return
  room.state = 'countdown'
  room.raceStartAt = 0
  for (const m of room.members) {
    m.finished = false
    m.timeMs = null
    m.checkpoint = -1
    m.falls = 0
    m.kills = 0
  }
  broadcast(room, { type: 'countdown', seconds: COUNTDOWN_MS / 1000, startsInMs: COUNTDOWN_MS })
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null
    if (room.members.length === 0) return
    room.state = 'racing'
    room.raceStartAt = performance.now()
    broadcast(room, { type: 'game_started' })
    console.log(`[room] ${room.code} 开跑，${room.members.length} 人`)
  }, COUNTDOWN_MS)
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.members.length, 0) }))
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('PY Party Run room server\n联机请连 /ws')
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
    if (room.state !== 'lobby') return fail(ws, 'GAME_IN_PROGRESS', '这局已经开跑了')
    if (room.members.length >= CAPACITY) return fail(ws, 'ROOM_FULL', `房间最多 ${CAPACITY} 人`)
    const nickname = cleanNickname(msg.nickname)
    if (!nickname) return fail(ws, 'BAD_MESSAGE', '昵称不能为空')
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
    if (room.members.length < MIN_PLAYERS) {
      return fail(ws, 'NOT_ENOUGH_PLAYERS', `至少要 ${MIN_PLAYERS} 人才能开跑`)
    }
    startGame(room)
    return
  }

  if (msg.type === 'back_to_lobby') {
    if (room.state === 'racing' || room.state === 'countdown') {
      if (room.countdownTimer) {
        clearTimeout(room.countdownTimer)
        room.countdownTimer = null
      }
      room.state = 'lobby'
      for (const m of room.members) {
        m.finished = false
        m.timeMs = null
        m.checkpoint = -1
        m.falls = 0
        m.kills = 0
      }
    }
    broadcast(room, { type: 'back_to_lobby' })
    broadcastRoomState(room)
    return
  }

  if (msg.type === 'player_state') {
    if (room.state !== 'racing') return
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
    if (room.state !== 'racing') return
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

  if (msg.type === 'checkpoint') {    if (room.state !== 'racing') return
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
})
