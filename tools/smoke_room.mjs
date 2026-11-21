/**
 * 房间服务端协议自测（不开浏览器，纯 WebSocket 客户端）。
 * 用法：node tools/smoke_room.mjs [ws://localhost:8000/ws]
 * 覆盖：建房/进房/房号不存在/非房主开跑/最少 2 人/开跑倒计时/位置中继/攻击转发/完赛榜单/满 8 人/房主转移
 */
import WebSocket from 'ws'

const URL_ = process.argv[2] ?? 'ws://localhost:8000/ws'
const results = []
let failures = 0

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

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
    send: (ev) => ws.send(JSON.stringify(ev)),
    wait: (match, timeout = 4000) => {
      const hit = inbox.find((m) => match(m))
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
const names = []

async function main() {
  const a = connect()
  await a.ready
  await a.wait(byType('hello'))
  check('A 收到 hello 并拿到 id', Boolean(a.inbox.find(byType('hello'))?.id))

  a.send({ type: 'create_room', nickname: '甲', color: '#ff3f8b' })
  const roomA = await a.wait(byType('room_state'))
  check('建房成功，房间号 4 位数字', /^\d{4}$/.test(roomA.code), `code=${roomA.code}`)
  check('房主是自己', roomA.hostId === a.inbox.find(byType('hello')).id)
  check('容量为 8', roomA.capacity === 8, `capacity=${roomA.capacity}`)
  check('建房后 1 人', roomA.players.length === 1)
  const code = roomA.code
  const aId = roomA.hostId

  // 只有 1 人时不能开跑（最少 2 人）
  a.send({ type: 'start_game' })
  const err3 = await a.wait(byType('error'))
  check('1 人开跑被拒 NOT_ENOUGH_PLAYERS', err3.code === 'NOT_ENOUGH_PLAYERS', err3.code)

  // 不存在的房间号
  const ghost = connect()
  await ghost.ready
  await ghost.wait(byType('hello'))
  ghost.send({ type: 'join_room', code: '0000', nickname: '幽灵', color: '#22d0c8' })
  const err1 = await ghost.wait(byType('error'))
  check('不存在的房号返回 ROOM_NOT_FOUND', err1.code === 'ROOM_NOT_FOUND', err1.code)
  ghost.close()

  // 2 人房：非房主开跑被拒
  const b = connect()
  await b.ready
  await b.wait(byType('hello'))
  b.send({ type: 'join_room', code, nickname: '乙', color: '#22d0c8' })
  const bRoom = await b.wait(byType('room_state'))
  const aRoom2 = await a.wait((m) => m.type === 'room_state' && m.players.length === 2)
  check('B 进房后房间 2 人', bRoom.players.length === 2 && aRoom2.players.length === 2)
  check('站位号 0 / 1 不重复', JSON.stringify(bRoom.players.map((p) => p.slot).sort()) === '[0,1]')

  b.send({ type: 'start_game' })
  const err2 = await b.wait(byType('error'))
  check('非房主开跑被拒 NOT_HOST', err2.code === 'NOT_HOST', err2.code)

  // 正式开跑（2 人）
  a.send({ type: 'start_game' })
  const cd = await a.wait(byType('countdown'))
  check('开跑倒数下发 3 秒', cd.seconds === 3 && cd.startsInMs === 3000)
  const cdB = await b.wait(byType('countdown'))
  check('B 也收到倒数', cdB.seconds === 3)
  const started = await a.wait(byType('game_started'), 5000)
  check('倒计时结束后下发 game_started', started.type === 'game_started')

  // 位置中继：A 发，B 收；A 自己不该收到
  a.send({ type: 'player_state', payload: { t: 1, p: [0, 0.2, -12], r: 0, s: 'run', a: 1 } })
  const relay = await b.wait(byType('player_state'))
  check('位置包中继给 B', relay.playerId === aId && relay.payload.p[2] === -12, JSON.stringify(relay.payload.p))

  // 攻击：A 挥拳 B 看到动画；A 报命中，B 收到 take_hit
  a.send({ type: 'attack', kind: 'heavy', side: 1 })
  const played = await b.wait(byType('attack_played'))
  check('出招动画广播给 B', played.playerId === aId && played.kind === 'heavy')
  a.send({ type: 'attack_hit', targetId: b.inbox.find(byType('hello')).id, kind: 'heavy', side: 1, x: 0, z: -12 })
  const hit = await b.wait(byType('take_hit'))
  check('命中转发给被打的人', hit.kind === 'heavy' && hit.fromId === aId)

  // 完赛：服务器计时 + 榜单
  b.send({ type: 'finish', t: 0 })
  const fin = await a.wait(byType('player_finished'))
  check('完赛事件带服务器计时', fin.timeMs > 0, `${fin.timeMs} ms`)
  const board = await a.wait(byType('leaderboard'))
  check('榜单按成绩排序', board.rows[0].playerId === b.inbox.find(byType('hello')).id || board.rows[0].finished)
  check('未完赛那行 timeMs 为 null', board.rows.some((r) => r.timeMs === null))

  // 回大厅
  a.send({ type: 'back_to_lobby' })
  const back = await a.wait(byType('back_to_lobby'))
  check('回大厅指令生效', back.type === 'back_to_lobby')

  // 满员：容量 8
  const extras = []
  for (let i = 0; i < 6; i += 1) {
    const cli = connect()
    await cli.ready
    await cli.wait(byType('hello'))
    cli.send({ type: 'join_room', code, nickname: `玩家${i}`, color: '#35e07a' })
    await cli.wait(byType('room_state'))
    extras.push(cli)
  }
  await sleep(200)
  const full = await a.wait((m) => m.type === 'room_state' && m.players.length === 8)
  check('8 人满员', full.players.length === 8, `${full.players.length} 人`)

  const ninth = connect()
  await ninth.ready
  await ninth.wait(byType('hello'))
  ninth.send({ type: 'join_room', code, nickname: '第九人', color: '#3fb6ff' })
  const err4 = await ninth.wait(byType('error'))
  check('第 9 人被拒 ROOM_FULL', err4.code === 'ROOM_FULL', err4.code)
  ninth.close()

  // 房主退出 → 转移
  a.close()
  await sleep(300)
  const afterHost = await b.wait((m) => m.type === 'room_state' && m.hostId !== aId, 3000).catch(() => null)
  check('房主退出后转移给下一人', Boolean(afterHost && afterHost.hostId === b.inbox.find(byType('hello')).id))

  for (const cli of extras) cli.close()
  b.close()
  await sleep(300)

  console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}：${results.length} 项`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('测试异常', err)
  process.exit(1)
})
