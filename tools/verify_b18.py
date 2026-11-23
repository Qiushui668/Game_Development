#!/usr/bin/env python
"""B1.8 验收：昵称 1 小时时效 / 多人页三栏 / 拳套 / 退出守卫 / 联机结算与再来一局。

用法：.venv\\Scripts\\python.exe tools\\verify_b18.py [url]

七条需求里，这个脚本覆盖"必须开浏览器才看得见"的部分：
  1 退出守卫（侧键 / Alt+← / 历史返回）
  2 有人退出后仍能继续跑（用第二个 WS 客户端中途退出，看画面还在跑）
  3 比赛中途加入（用一个 WS 机器人中途进房）
  4 有人冲线 → 全场结算 + 返回房间 / 再来一局 + 全员同意才自动开局
  5 昵称 1 小时时效（刷新不重复输入，过期后回昵称门）
  6 多人页布局（左建房 / 右输号 / 下方房间列表，点一下能进）
  7 赛道两侧巨型拳套（只沿 z 滑、随机出拳、被打飞回起点）
协议层（谁收到什么事件）由 tools/smoke_room_b18.mjs 单独覆盖。
"""

from __future__ import annotations

import asyncio
import base64
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from perf_probe import Cdp, find_chrome, free_port, list_targets  # noqa: E402

OUT_DIR = Path(__file__).parent

GATE_JS = r"""
(() => {
  const input = document.querySelector('.gate-input');
  const go = document.querySelector('.gate-go');
  const whoami = document.querySelector('.whoami');
  return {
    hasInput: !!input,
    value: input ? input.value : null,
    goDisabled: go ? go.disabled : null,
    whoami: whoami ? whoami.innerText.replace(/\s+/g, ' ').trim() : null,
    hasHome: !!document.querySelector('.home'),
  };
})()
"""

SET_NICK_JS = r"""
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gi = document.querySelector('.gate-input');
  if (!gi) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(gi, '验收员');
  gi.dispatchEvent(new Event('input', { bubbles: true }));
  // Vue 的 ref 与按钮 disabled 是下一帧才更新，等一拍再点
  await sleep(120);
  const go = document.querySelector('.gate-go');
  if (go && !go.disabled) {
    go.click();
    await sleep(120);
    return true;
  }
  return false;
})()
"""

ENTER_SOLO_JS = """(() => {
  const b = document.querySelector('.mode.solo');
  if (b) { b.click(); return true; }
  return false;
})()"""

MULTI_JS = r"""
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const online = document.querySelector('.mode.online');
  if (online) online.click();
  await sleep(500);
  const cols = document.querySelector('.multi-cols');
  const createCol = document.querySelector('.col.create');
  const joinCol = document.querySelector('.col.join');
  const rooms = document.querySelector('.rooms');
  const codeInput = document.querySelector('.col.join input.code');
  const items = [...document.querySelectorAll('.room-item')].map((el) => ({
    code: el.querySelector('.room-code')?.textContent.trim(),
    people: el.querySelector('.room-people')?.textContent.trim(),
    phase: el.querySelector('.room-phase')?.textContent.trim(),
    full: el.classList.contains('full'),
  }));
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    hasCols: !!cols,
    create: rect(createCol),
    join: rect(joinCol),
    rooms: rect(rooms),
    codeInput: !!codeInput,
    items,
    empty: document.querySelector('.rooms-empty')?.textContent.trim() ?? null,
  };
})()
"""

CLICK_ROOM_JS = r"""
(() => {
  const first = document.querySelector('.room-item');
  if (!first || first.classList.contains('full')) return false;
  first.click();
  return true;
})()
"""

LOBBY_JS = r"""
(() => ({
  lobby: !!document.querySelector('.lobby'),
  code: (document.querySelector('.code')?.textContent || '').trim(),
  players: document.querySelectorAll('.player:not(.empty)').length,
  startDisabled: document.querySelector('.start')?.disabled ?? null,
  startText: (document.querySelector('.start')?.textContent || '').trim(),
}))()
"""

GLOVE_JS = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  P.clearTiles();
  await sleep(250);
  const first = P.getGloves();
  const samples = [];
  for (let i = 0; i < 26; i += 1) {
    const g = P.getGloves();
    samples.push({ z: g.stations.map((s) => s.z), e: g.stations.map((s) => s.extend) });
    await sleep(110);
  }
  const zs = samples.map((s) => s.z[0]);
  const es = samples.map((s) => s.e[0]);
  return {
    tuning: first.tuning,
    count: first.stations.length,
    stations: first.stations.map((s) => ({ side: s.def.side, zCenter: s.def.zCenter, zRange: s.def.zRange })),
    zMin: Math.min(...zs),
    zMax: Math.max(...zs),
    zNow: zs[zs.length - 1],
    eMax: Math.max(...es),
    eMin: Math.min(...es),
    // 每只手套只在 zCenter ± zRange 里滑动（不左右移动）
    inRange: first.stations.every((s) => Math.abs(s.z - s.def.zCenter) <= s.def.zRange + 0.01),
    // 拳心 x 只能由"从墙里伸出来多少"决定：≤ wall - (reach*extend - wind)
    fist: first.stations.map((s) => s.fist),
    draw: (() => {
      const st = P.getPerf();
      return st ? { calls: st.drawCalls ?? st.calls ?? null } : null;
    })(),
  };
})()
"""

ELIMINATE_JS = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  P.clearTiles();
  await sleep(200);
  const before = P.getStatus();
  let hit = null;
  const t0 = performance.now();
  while (performance.now() - t0 < 8000) {
    const g = P.getGloves().stations[0];
    P.teleport(g.fist.x, 0.05, g.fist.z);
    await sleep(90);
    const now = P.getStatus();
    if (now.deaths > before.deaths) {
      hit = { extend: P.getGloves().stations[0].extend, at: performance.now() - t0 };
      break;
    }
  }
  // 飞出去 1 s 后应该已经回起点
  await sleep(1500);
  const after = P.getStatus();
  const st = P.getPlayer();
  return { before, after, hit, pos: st ? { x: st.x, y: st.y, z: st.z } : null, race: P.getRace().state };
})()
"""

GUARD_JS = r"""
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const side = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true });
  window.dispatchEvent(side);
  const aux = new MouseEvent('auxclick', { button: 4, bubbles: true, cancelable: true });
  window.dispatchEvent(aux);
  const back = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(back);
  const bs = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
  window.dispatchEvent(bs);
  const href0 = location.href;
  const hadPpr = !!window.__PPR;
  history.back();
  await sleep(700);
  const tip = !!document.querySelector('.guard-tip');
  return {
    sidePrevented: side.defaultPrevented,
    auxPrevented: aux.defaultPrevented,
    altLeftPrevented: back.defaultPrevented,
    backspacePrevented: bs.defaultPrevented,
    tipShown: tip,
    stillInGame: !!window.__PPR === hadPpr && !!window.__PPR,
    hrefSame: location.href === href0,
  };
})()
"""

SHOT_GLOVE = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  P.clearTiles();
  const g = P.getGloves().stations[0];
  // 站在赛道中线、拳套前 10 m，正面看墙上的手套（能同时看到滑轨、手臂、拳套与袖口）
  P.teleport(0, 0.05, g.def.zCenter + 10);
  await sleep(500);
  P.setOrbit(0, 10);
  await sleep(900);
  return P.getGloves().stations[0];
})()
"""

SHOT_GLOVE_PUNCH = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now();
  // 等它探到最外侧再截图（拳头打进赛道的那一瞬间）
  while (performance.now() - t0 < 6000) {
    const g = P.getGloves().stations[0];
    if (g.extend > 0.9) return { extend: g.extend, z: g.z };
    await sleep(60);
  }
  return { extend: P.getGloves().stations[0].extend };
})()
"""

ONLINE_JS = r"""
(() => {
  const badge = document.querySelector('.room-badge');
  const result = document.querySelector('.result');
  return {
    inGame: !!window.__PPR && !!window.__PPR.ready,
    badge: badge ? badge.textContent.replace(/\s+/g, ' ').trim() : null,
    race: window.__PPR ? window.__PPR.getRace().state : null,
    result: result ? {
      hasGhost: !!document.querySelector('.actions .ghost'),
      hasAgain: !!document.querySelector('.actions .again'),
      againText: (document.querySelector('.actions .again')?.textContent || '').trim(),
      hint: (document.querySelector('.hint')?.textContent || '').trim(),
      rows: document.querySelectorAll('.row').length,
      score: (document.querySelector('.score')?.textContent || '').trim(),
    } : null,
    backHome: !!document.querySelector('.home'),
  };
})()
"""


async def ui_click(cdp: Cdp, selector: str, timeout: float = 8.0) -> bool:
    """轮询点一个按钮：等它出现、等它从 disabled 变可用，再点（Vue 的 disabled 晚一帧）。"""
    js = (
        "(() => { const el = document.querySelector(%s); if (!el) return 'missing'; "
        "if (el.disabled) return 'disabled'; el.click(); return 'ok'; })()"
    ) % json.dumps(selector)
    deadline = time.time() + timeout
    last = 'missing'
    while time.time() < deadline:
        last = await cdp.eval_js(js)
        if last == 'ok':
            await asyncio.sleep(0.25)
            return True
        await asyncio.sleep(0.25)
    print(f'  （点 {selector} 没成功：{last}）', flush=True)
    return False


async def shoot(cdp: Cdp, js: str, png: Path, wait_s: float = 0.2) -> None:
    await cdp.eval_js(js, timeout_s=60)
    await asyncio.sleep(wait_s)
    res = await cdp.call("Page.captureScreenshot", {"format": "png"})
    png.write_bytes(base64.b64decode(res["data"]))


class Bot:
    """极简 WS 机器人：只用来造"房间里还有别人 / 中途加入 / 冲线"的场景。"""

    def __init__(self, ws, nickname: str, color: str) -> None:
        self.ws = ws
        self.nickname = nickname
        self.color = color
        self.inbox: list[dict] = []
        self.id = ''

    @classmethod
    async def open(cls, nickname: str, color: str = '#35e07a'):
        from websockets import connect

        ws = await connect('ws://localhost:8000/ws', max_size=4 * 1024 * 1024)
        bot = cls(ws, nickname, color)
        bot.id = (await bot.wait('hello'))['id']
        return bot

    async def wait(self, type_: str, timeout: float = 6.0) -> dict:
        deadline = time.time() + timeout
        seen = len(self.inbox)
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(self.ws.recv(), timeout=0.4)
            except asyncio.TimeoutError:
                continue
            msg = json.loads(raw)
            self.inbox.append(msg)
            if msg.get('type') == type_:
                return msg
        raise TimeoutError(f'等待 {type_} 超时（收到 {[m.get("type") for m in self.inbox[seen:]]}）')

    async def send(self, ev: dict) -> None:
        await self.ws.send(json.dumps(ev))


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5173/'
    port = free_port()
    profile = tempfile.mkdtemp(prefix='ppr_verify_b18_')
    proc = subprocess.Popen(
        [
            find_chrome(),
            f'--remote-debugging-port={port}',
            f'--user-data-dir={profile}',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--window-size=1280,760',
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    results: list[dict] = []
    failures = 0

    def check(name: str, ok: bool, detail: str = '') -> None:
        nonlocal failures
        results.append({'name': name, 'ok': bool(ok), 'detail': detail})
        if not ok:
            failures += 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}".rstrip(), flush=True)

    bots: list[Bot] = []
    try:
        targets = list_targets(port)
        page = next((t for t in targets if t.get('type') == 'page' and '5173' in t.get('url', '')), None)
        if page is None:
            page = next((t for t in targets if t.get('type') == 'page'), None)
        if page is None:
            raise SystemExit('找不到页面目标')

        from websockets import connect

        async with connect(page['webSocketDebuggerUrl'], max_size=32 * 1024 * 1024) as ws:
            cdp = Cdp(ws)
            await cdp.call('Runtime.enable')
            await cdp.call('Page.enable')

            # ---------- 需求 5：昵称门 + 1 小时时效 ----------
            gate = None
            deadline = time.time() + 30
            while time.time() < deadline:
                gate = await cdp.eval_js(GATE_JS)
                if gate and gate.get('hasInput'):
                    break
                gate = None
                await asyncio.sleep(0.4)
            if gate is None:
                raise SystemExit('昵称门没出现')
            check('全新浏览器：先过昵称门，输入框为空', gate['value'] == '' and gate['goDisabled'] is True,
                  json.dumps(gate, ensure_ascii=False))

            await cdp.eval_js(SET_NICK_JS)
            await asyncio.sleep(0.5)
            named = await cdp.eval_js(GATE_JS)
            check('填完昵称进入首页（不再看到昵称门）', named['hasInput'] is False and '验收员' in (named['whoami'] or ''),
                  json.dumps(named, ensure_ascii=False))

            # 刷新页面：1 小时有效期内不该再让填
            await cdp.eval_js('location.reload()')
            await asyncio.sleep(2.0)
            reloaded = await cdp.eval_js(GATE_JS)
            check('有效期内刷新页面：直接跳过昵称门', reloaded['hasInput'] is False and '验收员' in (reloaded['whoami'] or ''),
                  json.dumps(reloaded, ensure_ascii=False))
            ttl_tip = await cdp.eval_js(
                "(() => (document.querySelector('.whoami-ttl')?.textContent || '').trim())()"
            )
            check('身份条上给出昵称剩余有效期', '分钟' in (ttl_tip or ''), ttl_tip)

            # 把时间戳改到 2 小时前 → 视为过期
            await cdp.eval_js(
                "localStorage.setItem('ppr:nicknameAt', String(Date.now() - 2 * 60 * 60 * 1000))"
            )
            await cdp.eval_js('location.reload()')
            await asyncio.sleep(2.0)
            expired = await cdp.eval_js(GATE_JS)
            check('昵称过期 1 小时后：回到昵称门且输入框依然为空',
                  expired['hasInput'] is True and expired['value'] == '' and expired['goDisabled'] is True,
                  json.dumps(expired, ensure_ascii=False))

            await cdp.eval_js(SET_NICK_JS)
            await asyncio.sleep(0.6)

            # ---------- 需求 6：多人页布局 ----------
            # 先起一个机器人建一间房，让"下方已有房间"有内容可点
            host_bot = await Bot.open('列表房主', '#ffd23f')
            bots.append(host_bot)
            await host_bot.send({'type': 'create_room', 'nickname': '列表房主', 'color': '#ffd23f'})
            room_state = await host_bot.wait('room_state')
            list_code = room_state['code']
            await asyncio.sleep(3.2)  # 等首页那边 3 s 轮询刷一次
            multi = await cdp.eval_js(MULTI_JS, timeout_s=40)
            await cdp.eval_js("(() => { void 0 })()")
            check('多人页是"左建房 / 右输号"两栏',
                  multi['hasCols'] and multi['create']['x'] < multi['join']['x'] and multi['codeInput'],
                  json.dumps({'create': multi['create'], 'join': multi['join']}, ensure_ascii=False))
            check('两栏在上、房间列表在下（列表整体更靠下）',
                  multi['rooms'] is not None and multi['rooms']['y'] > multi['create']['y'] + multi['create']['h'] - 4,
                  json.dumps(multi['rooms'], ensure_ascii=False))
            await asyncio.sleep(2.2)
            multi2 = await cdp.eval_js(MULTI_JS, timeout_s=40)
            check('下方列出在线房间（带人数 / 阶段）',
                  any(item['code'] == list_code for item in (multi2['items'] or [])),
                  json.dumps(multi2['items'], ensure_ascii=False))
            await shoot(cdp, "(() => { void 0 })()", OUT_DIR / 'perf_b18_multi.png', 0.1)

            clicked = await cdp.eval_js(CLICK_ROOM_JS)
            await asyncio.sleep(1.6)
            lobby = await cdp.eval_js(LOBBY_JS)
            check('点房间卡片直接进房（进大厅，房间号一致）',
                  clicked is True and lobby['lobby'] is True and lobby['code'] == list_code,
                  json.dumps(lobby, ensure_ascii=False))

            await cdp.eval_js("(() => { document.querySelector('.leave')?.click(); return true })()")
            await asyncio.sleep(1.2)
            back_home = await cdp.eval_js(GATE_JS)
            check('离开房间回到首页', back_home['hasHome'] is True)

            # 首页会停在"多人"面板上，先退回模式选择再走单人局
            await ui_click(cdp, '.multi .back', 4.0)
            await asyncio.sleep(0.4)

            # 机器人房主也退掉，别占着房间
            await host_bot.ws.close()
            await asyncio.sleep(0.4)

            # ---------- 需求 7：拳套 ----------
            await ui_click(cdp, '.mode.solo', 10.0)
            deadline = time.time() + 30
            while time.time() < deadline:
                ready = await cdp.eval_js("!!(window.__PPR && window.__PPR.getGloves)")
                if ready:
                    break
                await asyncio.sleep(0.4)
            else:
                raise SystemExit('页面未就绪（__PPR.getGloves 不存在）')

            glove = await cdp.eval_js(GLOVE_JS, timeout_s=60)
            check('赛道两侧一共 4 只巨型拳套（左右交替）',
                  glove['count'] == 4 and [s['side'] for s in glove['stations']] == [-1, 1, -1, 1],
                  json.dumps(glove['stations'], ensure_ascii=False))
            check('拳套沿 Z 前后滑动（3 s 内位移 > 2 m），且不越出各自滑轨',
                  glove['zMax'] - glove['zMin'] > 2.0 and glove['inRange'],
                  f"z {glove['zMin']:.2f} → {glove['zMax']:.2f} inRange={glove['inRange']}")
            check('拳套随机出拳：探出比例在 0–1 之间来回',
                  glove['eMax'] > 0.85 and glove['eMin'] < 0.2,
                  f"extend {glove['eMin']:.2f} – {glove['eMax']:.2f}")

            elim = await cdp.eval_js(ELIMINATE_JS, timeout_s=60)
            check('被拳套打飞 → 记一次淘汰（deaths +1）',
                  elim['hit'] is not None and elim['after']['deaths'] > elim['before']['deaths'],
                  json.dumps({'hit': elim['hit'], 'before': elim['before'], 'after': elim['after']}, ensure_ascii=False))
            check('打飞只在拳头真伸出来时判定（extend ≥ 0.6）',
                  elim['hit'] is not None and elim['hit']['extend'] >= 0.6,
                  json.dumps(elim['hit'], ensure_ascii=False))
            check('淘汰后回起点复活（z≈3.5、满血）',
                  elim['pos'] is not None and abs(elim['pos']['z'] - 3.5) < 1.2 and elim['after']['hp'] == 100,
                  json.dumps(elim['pos'], ensure_ascii=False))

            # ---------- 需求 1：退出守卫 ----------
            guard = await cdp.eval_js(GUARD_JS, timeout_s=40)
            check('鼠标侧键（后退/前进键）被拦下',
                  guard['sidePrevented'] is True and guard['auxPrevented'] is True,
                  json.dumps(guard, ensure_ascii=False))
            check('Alt+← 与 Backspace 被拦下', guard['altLeftPrevented'] is True and guard['backspacePrevented'] is True,
                  json.dumps(guard, ensure_ascii=False))
            check('浏览器返回（history.back）不会把游戏带走', guard['stillInGame'] is True and guard['hrefSame'] is True,
                  json.dumps(guard, ensure_ascii=False))
            check('被拦下时给了提示', guard['tipShown'] is True, str(guard['tipShown']))

            # 拳套截图取证：滑到墙边 / 正好出拳
            await shoot(cdp, SHOT_GLOVE, OUT_DIR / 'perf_b18_glove.png', 0.3)
            punch = await cdp.eval_js(SHOT_GLOVE_PUNCH, timeout_s=40)
            res = await cdp.call('Page.captureScreenshot', {'format': 'png'})
            (OUT_DIR / 'perf_b18_glove_punch.png').write_bytes(base64.b64decode(res['data']))
            check('出拳瞬间拳头真正伸进赛道（extend > 0.9）', punch.get('extend', 0) > 0.9,
                  json.dumps(punch, ensure_ascii=False))

            # 回首页，准备联机部分
            await ui_click(cdp, '.canvas-host .exit', 6.0)
            await asyncio.sleep(1.0)

            # ---------- 需求 2 / 3 / 4：联机 ----------
            entered = await ui_click(cdp, '.mode.online', 10.0)
            await asyncio.sleep(0.4)
            created = await ui_click(cdp, '.col.create .primary', 8.0)
            await asyncio.sleep(2.0)
            lobby = await cdp.eval_js(LOBBY_JS)
            check('建房后进大厅并显示房间号',
                  entered and created and lobby['lobby'] is True and len(lobby['code']) == 4,
                  json.dumps({'entered': entered, 'created': created, **lobby}, ensure_ascii=False))
            code = lobby['code']

            b1 = await Bot.open('玩家乙', '#22d0c8')
            bots.append(b1)
            await b1.send({'type': 'join_room', 'code': code, 'nickname': '玩家乙', 'color': '#22d0c8'})
            await b1.wait('room_state')
            await asyncio.sleep(1.0)
            lobby2 = await cdp.eval_js(LOBBY_JS)
            check('第二个人进房后大厅显示 2 人并可开始', lobby2['players'] == 2 and lobby2['startDisabled'] is False,
                  json.dumps(lobby2, ensure_ascii=False))

            await cdp.eval_js("(() => { document.querySelector('.start')?.click(); return true })()")
            deadline = time.time() + 20
            stable = 0
            while time.time() < deadline:
                st = await cdp.eval_js(ONLINE_JS)
                if st['inGame'] and st['race'] == 'Racing':
                    stable += 1
                    # 连查 4 次（约 2 s）都在 Racing 才算真的跑起来了，
                    # 否则可能是"倒数期间快照"或上一局残留，进去会拿到 countdown
                    if stable >= 4:
                        break
                else:
                    stable = 0
                await asyncio.sleep(0.5)
            else:
                st = await cdp.eval_js(ONLINE_JS)
                raise SystemExit(f'联机没跑起来：{json.dumps(st, ensure_ascii=False)}')

            # 3：比赛中途加入（此时确实已在 racing，新人应拿到 elapsedMs > 0）
            b2 = await Bot.open('玩家丙', '#ffd23f')
            bots.append(b2)
            await b2.send({'type': 'join_room', 'code': code, 'nickname': '玩家丙', 'color': '#ffd23f'})
            gs = await b2.wait('game_state')
            check('比赛中途加入：新人直接收到"这局跑到哪了"',
                  gs['state'] == 'racing' and gs.get('elapsedMs', 0) > 0,
                  json.dumps(gs, ensure_ascii=False))
            await asyncio.sleep(1.2)
            mid = await cdp.eval_js(ONLINE_JS)
            check('房主画面人数跟着变（3 人）', '3 人' in (mid['badge'] or '') and mid['race'] == 'Racing',
                  json.dumps(mid, ensure_ascii=False))

            # 2：有人退出，其他人照跑
            await b2.ws.close()
            bots.remove(b2)
            await asyncio.sleep(1.4)
            after_leave = await cdp.eval_js(ONLINE_JS)
            check('有人退出后仍在比赛中（没被踢回首页 / 没关房）',
                  after_leave['race'] == 'Racing' and after_leave['backHome'] is False and '2 人' in (after_leave['badge'] or ''),
                  json.dumps(after_leave, ensure_ascii=False))

            # 4：有人冲线 → 全场结算
            await b1.send({'type': 'finish', 't': 1000})
            deadline = time.time() + 8
            panel = None
            while time.time() < deadline:
                panel = await cdp.eval_js(ONLINE_JS)
                if panel['result']:
                    break
                await asyncio.sleep(0.3)
            if not panel or not panel['result']:
                raise SystemExit(f'冲线后没弹结算：{json.dumps(panel, ensure_ascii=False)}')
            check('别人冲线后自己（还在跑）也弹结算', panel['result']['rows'] >= 2, json.dumps(panel['result'], ensure_ascii=False))
            check('结算面板有「返回房间」和「再来一局」两个按钮',
                  panel['result']['hasGhost'] is True and panel['result']['hasAgain'] is True,
                  json.dumps(panel['result'], ensure_ascii=False))
            check('结算面板写明"全员同意才开下一局"', '全员' in (panel['result']['hint'] or ''),
                  panel['result']['hint'])
            await shoot(cdp, "(() => { void 0 })()", OUT_DIR / 'perf_b18_result.png', 0.1)

            # 自己点再来一局 → 只算 1 票，不开局
            await cdp.eval_js("(() => { document.querySelector('.actions .again')?.click(); return true })()")
            await asyncio.sleep(1.0)
            voted = await cdp.eval_js(ONLINE_JS)
            check('点了再来一局后显示"已同意 1/2"，自己不能再点',
                  '1/2' in (voted['result']['hint'] or '') and '已同意' in (voted['result']['hint'] or ''),
                  json.dumps(voted['result'], ensure_ascii=False))
            check('只有 1 票时不开下一局（仍然停在结算页）', voted['result'] is not None and voted['race'] == 'Result',
                  json.dumps({'race': voted['race']}, ensure_ascii=False))

            # 另一人也同意 → 自动开跑
            await b1.send({'type': 'rematch'})
            deadline = time.time() + 8
            started = None
            while time.time() < deadline:
                started = await cdp.eval_js(ONLINE_JS)
                if started['result'] is None and started['race'] in ('Countdown', 'Racing'):
                    break
                await asyncio.sleep(0.3)
            check('全员同意后自动开下一局（结算面板消失、重新倒数/起跑）',
                  started is not None and started['result'] is None and started['race'] in ('Countdown', 'Racing'),
                  json.dumps(started, ensure_ascii=False))

    finally:
        for bot in bots:
            try:
                await bot.ws.close()
            except Exception:
                pass
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    report = {
        'url': url,
        'collectedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
        'pass': failures == 0,
        'results': results,
    }
    (OUT_DIR / 'verify_b18.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"\n{'全部通过' if failures == 0 else f'{failures} 项失败'}（{len(results)} 项）", flush=True)
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
