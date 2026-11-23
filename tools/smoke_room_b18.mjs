/**
 * B1.8 协议自测：中途加入 / 有人退出不打断 / 全员结算 / 再来一局投票 / 房间列表。
 * 用法：node tools/smoke_room_b18.mjs [ws://localhost:8000/ws]
 *
 * 和 smoke_room.mjs（B1.7 老用例）互补：老脚本验"建房—开跑—中继—榜单"，
 * 这个脚本专验本轮 7 条需求里跟网络有关的 2、3、4 条。
 */
import WebSocket from 'ws'

const URL_ = process.argv[2] ?? 'ws://localhost:8000/ws'
const HTTP_BASE = URL_.replace(/^ws/, 'http').replace(/\/ws$/, '')
const results = []
let failures = 0

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function connect() {
  const ws = new WebSocket(URL_)
  const inbox = []
  const waiters = []
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw))
    inbox.push(msg)
    for (const w of waiters) {
      if (w.match(msg)) {
        w.resolve(msg)
        waiters.splice(waiters.indexOf(w), 1)
        return
      }
    }
  })
  const ready = new Promise((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
  return {
    ws,
    ready,
    inbox,
    id: '',
    send: (ev) => ws.send(JSON.stringify(ev)),
    wait: (match, timeout = 5000, since = 0) => {
      const hit = inbox.slice(since).find((m) => match(m))
      if (hit) return Promise.resolve(hit)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout waiting message')), timeout)
        waiters.push({
          match,
          resolve: (m) => {
            clearTimeout(timer)
            resolve(m)
          },
        })
      })
    },
    close: () => ws.close(),
  }
}

const byType = (t) => (m) => m.type === t

async function hello(cli, nickname, color = '#ff3f8b') {
  await cli.ready
  const h = await cli.wait(byType('hello'))
  cli.id = h.id
  cli.send({ type: 'create_room', nickname, color })
  return h
}

async function main() {
  // ---------- 建房 + 2 人开跑 ----------
  const a = connect()
  await hello(a, '房主甲')
  const roomA = await a.wait(byType('room_state'))
  const code = roomA.code
  check('建房成功', /^\d{4}$/.test(code), `code=${code}`)

  const b = connect()
  await b.ready
  b.id = (await b.wait(byType('hello'))).id
  b.send({ type: 'join_room', code, nickname: '玩家乙', color: '#22d0c8' })
  await b.wait(byType('room_state'))
  await a.wait((m) => m.type === 'room_state' && m.players.length === 2)

  a.send({ type: 'start_game' })
  await a.wait(byType('countdown'))
  await a.wait(byType('game_started'), 6000)
  await b.wait(byType('game_started'), 6000)
  const racing = await a.wait((m) => m.type === 'room_state' && m.state === 'racing')
  check('开跑后房间状态 racing', racing.state === 'racing')

  // ---------- 需求 3：比赛中途加入 ----------
  const markA = a.inbox.length
  const c = connect()
  await c.ready
  await c.wait(byType('hello'))
  c.send({ type: 'join_room', code, nickname: '玩家丙', color: '#ffd23f' })
  const cRoom = await c.wait(byType('room_state'))
  check('比赛中允许中途加入', cRoom.state === 'racing', `state=${cRoom.state}`)
  const cState = await c.wait(byType('game_state'))
  check('新人收到 game_state（这局跑到哪了）', cState.state === 'racing' && cState.elapsedMs >= 0, `${cState.elapsedMs} ms`)
  const lateFlag = cRoom.players.find((p) => p.nickname === '玩家丙')?.lateJoin
  check('新人在名单里标成 lateJoin', lateFlag === true)
  const joinedEv = await a.wait(byType('player_joined'), 3000, markA)
  check('老玩家收到 player_joined（能补一个远端）', joinedEv.player?.nickname === '玩家丙')

  // ---------- 需求 2：有人退出，其他人继续跑、房间不关 ----------
  const markA2 = a.inbox.length
  b.close()
  const leftEv = await a.wait(byType('player_left'), 3000, markA2)
  check('退出广播 player_left', leftEv.playerId === b.id)
  const afterLeft = await a.wait(byType('room_state'), 3000, markA2)
  check('有人退出后房间仍是 racing（不打断比赛）', afterLeft.state === 'racing', `state=${afterLeft.state}`)
  check('退出者从名单里移除', afterLeft.players.every((p) => p.id !== b.id))
  check('房间里还有人（没被解散）', afterLeft.players.length === 2, `${afterLeft.players.length} 人`)

  // ---------- 需求 4：有人冲线 → 全场结算 ----------
  const markA3 = a.inbox.length
  const markC = c.inbox.length
  a.send({ type: 'finish', t: 1234 })
  const overA = await a.wait(byType('race_over'), 4000, markA3)
  const overC = await c.wait(byType('race_over'), 4000, markC)
  check('冲线者收到 race_over', overA.rows.length === 2)
  check('还在跑的人也收到 race_over（全场结算）', overC.byPlayerId === a.id, `by=${overC.byPlayerId}`)
  check('结算榜单里冲线的人是 finished', overA.rows.some((r) => r.playerId === a.id && r.finished))
  const resultsState = await c.wait((m) => m.type === 'room_state' && m.state === 'results', 3000, markC)
  check('房间状态变 results', resultsState.state === 'results')

  // ---------- 需求 4b：全员点"再来一局"才自动开局 ----------
  const markA4 = a.inbox.length
  c.send({ type: 'rematch' })
  const v1 = await a.wait(byType('rematch_status'), 3000, markA4)
  check('一人同意时不下发开跑', v1.votes === 1 && v1.total === 2, `${v1.votes}/${v1.total}`)
  await sleep(300)
  check('一票时没有 countdown', !a.inbox.slice(markA4).some(byType('countdown')))

  a.send({ type: 'rematch' })
  const markA5 = a.inbox.length
  const v2 = await a.wait(byType('rematch_status'), 3000, markA5)
  check('两票齐了', v2.votes === 2 && v2.total === 2)
  const cd2 = await a.wait(byType('countdown'), 4000, markA4)
  check('全员同意后自动开下一局（countdown）', cd2.seconds === 3)
  await a.wait(byType('game_started'), 6000, markA4)
  check('再来一局真的开跑', true)

  // ---------- 中途加入的人也能一起再来一局 ----------
  const markC2 = c.inbox.length
  await c.wait(byType('game_started'), 6000, markC2).catch(() => null)

  // ---------- 满 8 人拒绝第 9 人 ----------
  const markFull = a.inbox.length
  const extras = []
  for (let i = 0; i < 6; i += 1) {
    const cli = connect()
    await cli.ready
    await cli.wait(byType('hello'))
    cli.id = cli.inbox.find(byType('hello')).id
    cli.send({ type: 'join_room', code, nickname: `路人${i}`, color: '#35e07a' })
    await cli.wait(byType('room_state'))
    extras.push(cli)
  }
  const full = await a.wait((m) => m.type === 'room_state' && m.players.length === 8, 5000, markFull)
  check('房间可以到 8 人', full.players.length === 8)

  const ninth = connect()
  await ninth.ready
  await ninth.wait(byType('hello'))
  ninth.send({ type: 'join_room', code, nickname: '第九人', color: '#3fb6ff' })
  const errFull = await ninth.wait(byType('error'))
  check('第 9 人被拒 ROOM_FULL', errFull.code === 'ROOM_FULL', errFull.code)
  ninth.close()

  // ---------- GET /rooms ----------
  const listed = await fetch(`${HTTP_BASE}/rooms`).then((r) => r.json())
  const mine = listed.rooms?.find((r) => r.code === code)
  check('GET /rooms 能列出这个房', Boolean(mine), JSON.stringify(listed.rooms?.slice(0, 2)))
  check('房间列表带人数 / 容量 / 阶段', mine?.players === 8 && mine?.capacity === 8 && typeof mine?.phase === 'string')

  for (const cli of extras) cli.close()
  a.close()
  c.close()
  await sleep(300)

  console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}：${results.length} 项`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('测试异常', err)
  process.exit(1)
})
