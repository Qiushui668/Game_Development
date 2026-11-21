"""B 阶段局域网联机验收（双浏览器真机跑）。

两个独立的 Chrome 实例（各自独立 profile 与调试端口，避免后台标签被降帧），
分别扮演房主与加入者，走真实 UI：首页 -> 多人 -> 建房 / 输房号加入 -> 房主开跑 ->
双人同步跑动、互相出招打倒、答题被打断、冲线结算。

用法（必须用项目 .venv 的 Python）：
  .venv\\Scripts\\python.exe tools\\verify_m7.py

前置：Vite 在 http://localhost:5173，房间服务在 ws://localhost:8000/ws。
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
]


def find_chrome() -> str:
    for path in CHROME_CANDIDATES:
        if Path(path).is_file():
            return path
    raise SystemExit("未找到 chrome.exe")


def free_port(start: int = 9333, span: int = 80) -> int:
    for port in range(start, start + span):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit("没有可用端口")


def list_targets(port: int, timeout: float = 25.0) -> list[dict]:
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/json/list"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, list) and data:
                    pages = [t for t in data if t.get("type") == "page"]
                    if pages:
                        return pages
        except Exception:
            pass
        time.sleep(0.3)
    raise SystemExit(f"CDP 端口 {port} 未就绪")


class Cdp:
    def __init__(self, ws) -> None:
        self.ws = ws
        self._id = 0

    async def call(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        msg_id = self._id
        await self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        while True:
            raw = await self.ws.recv()
            msg = json.loads(raw)
            if msg.get("id") == msg_id:
                if "error" in msg:
                    raise RuntimeError(f"{method} 失败: {msg['error']}")
                return msg.get("result", {})

    async def eval_js(self, expression: str):
        res = await self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
        )
        if res.get("exceptionDetails"):
            detail = res["exceptionDetails"].get("exception", {}).get("description")
            raise RuntimeError(f"JS 异常: {detail or res['exceptionDetails']}")
        return res.get("result", {}).get("value")

    async def shot(self, path: Path) -> None:
        data = await self.call("Page.captureScreenshot", {"format": "png"})
        path.write_bytes(base64.b64decode(data["data"]))


class Page:
    """一个浏览器实例里的一个页面"""

    def __init__(self, proc: subprocess.Popen, cdp: Cdp, profile: str, name: str) -> None:
        self.proc = proc
        self.cdp = cdp
        self.profile = profile
        self.name = name

    async def js(self, expr: str):
        return await self.cdp.eval_js(expr)

    async def shot(self, path: Path) -> None:
        await self.cdp.shot(path)

    async def wait(self, expr: str, timeout: float = 12.0, interval: float = 0.15):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            last = await self.cdp.eval_js(expr)
            if last:
                return last
            await asyncio.sleep(interval)
        raise RuntimeError(f"[{self.name}] 等待超时: {expr}（最后值 {last!r}）")

    def close(self) -> None:
        try:
            self.proc.terminate()
            self.proc.wait(timeout=6)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        shutil.rmtree(self.profile, ignore_errors=True)


async def open_page(port: int, url: str, position: str, size: str, name: str) -> Page:
    profile = tempfile.mkdtemp(prefix=f"ppr_m7_{name}_")
    proc = subprocess.Popen(
        [
            find_chrome(),
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-features=CalculateNativeWinOcclusion",
            f"--window-size={size}",
            f"--window-position={position}",
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    targets = await asyncio.to_thread(list_targets, port)
    ws = await websockets.connect(targets[0]["webSocketDebuggerUrl"], max_size=32 * 1024 * 1024)
    cdp = Cdp(ws)
    await cdp.call("Runtime.enable")
    await cdp.call("Page.enable")
    return Page(proc, cdp, profile, name)


SET_INPUT = """(sel, val) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}"""

CLICK = """(sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.click();
  return true;
}"""


async def set_input(page: Page, sel: str, val: str) -> None:
    ok = await page.js(f"({SET_INPUT})({json.dumps(sel)}, {json.dumps(val)})")
    if not ok:
        raise RuntimeError(f"[{page.name}] 找不到输入框 {sel}")


async def click(page: Page, sel: str) -> None:
    ok = await page.js(f"({CLICK})({json.dumps(sel)})")
    if not ok:
        raise RuntimeError(f"[{page.name}] 点不到元素 {sel}")


async def wait_game_ready(page: Page, timeout: float = 40.0) -> None:
    await page.wait(
        "(() => { const p = window.__PPR; if (!p || !p.ready) return false; return !!p.getNet(); })()",
        timeout=timeout,
        interval=0.3,
    )


async def run(args: argparse.Namespace) -> int:
    results: list[dict] = []
    failures = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failures
        results.append({"name": name, "ok": bool(ok), "detail": detail})
        if not ok:
            failures += 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}".rstrip(), flush=True)

    p1 = await open_page(free_port(9401), args.url, "0,0", "900,620", "p1")
    p2 = await open_page(free_port(9481), args.url, "900,0", "900,620", "p2")

    try:
        # ---------- 首页：先昵称门，再模式选择 ----------
        for p in (p1, p2):
            await p.wait("!!document.querySelector('.gate')", 25)
        gate_only = await p1.js(
            "(() => ({ gate: !!document.querySelector('.gate'), "
            "modes: document.querySelectorAll('.mode').length }))()"
        )
        check(
            "进站先要昵称（未确认前不显示单人/多人）",
            gate_only["gate"] is True and gate_only["modes"] == 0,
            json.dumps(gate_only),
        )
        await set_input(p1, ".gate-input", "房主甲")
        await click(p1, ".gate-go")
        await set_input(p2, ".gate-input", "玩家乙")
        await click(p2, ".gate-go")
        for p in (p1, p2):
            await p.wait("!!document.querySelector('.mode.online')", 8)
        saved = await p1.js("window.localStorage.getItem('ppr:nickname')")
        check("昵称写进本地记忆（下次自动填）", saved == "房主甲", f"saved={saved}")

        modes = await p1.js(
            "(() => [...document.querySelectorAll('.mode .name')].map(e => e.textContent.trim()))()"
        )
        check("首页展示单人 / 多人两个入口", modes == ["单人游戏", "多人游戏"], json.dumps(modes, ensure_ascii=False))
        await p1.shot(Path(args.out) / "perf_m7_home.png")

        # ---------- 房主建房（昵称已在大门口确认过，房间面板不再问） ----------
        await click(p1, ".mode.online")
        await p1.wait("!!document.querySelector('.form')", 5)
        await click(p1, ".primary")
        code = await p1.wait(
            "(() => { const e = document.querySelector('.lobby .code'); "
            "return e && /^\\d{4}$/.test(e.textContent.trim()) ? e.textContent.trim() : false; })()",
            8,
        )
        check("创建房间得到 4 位房间号", bool(code), f"code={code}")

        start_disabled = await p1.js(
            "(() => { const b = document.querySelector('.lobby .start'); return b ? b.disabled : null; })()"
        )
        check("只有 1 人时开始按钮禁用（最少 2 人）", start_disabled is True, f"disabled={start_disabled}")

        # ---------- 第二人输房号加入 ----------
        await click(p2, ".mode.online")
        await p2.wait("!!document.querySelector('.form')", 5)
        await click(p2, ".tabs .tab:nth-child(2)")
        await p2.wait("!!document.querySelector('.field input.code')", 5)
        await set_input(p2, ".field input.code", str(code))
        await click(p2, ".primary")
        await p2.wait("!!document.querySelector('.lobby')", 8)

        joined = await p1.wait(
            "(() => { const c = document.querySelector('.lobby .count'); "
            "return c && c.textContent.includes('2 /') ? c.textContent.trim() : false; })()",
            8,
        )
        check("两人都在房间里（2 / 8）", bool(joined), f"count={joined}")
        check(
            "第二人是加入者（不是房主）",
            await p2.js(
                "!!document.querySelector('.player .tag.host') && !document.querySelector('.lobby .start')"
            ),
        )
        await p1.shot(Path(args.out) / "perf_m7_lobby.png")

        # ---------- 房主开跑：两人同时进游戏 ----------
        await click(p1, ".lobby .start")
        await asyncio.gather(wait_game_ready(p1), wait_game_ready(p2))

        net1 = await p1.js("window.__PPR.getNet()")
        net2 = await p2.js("window.__PPR.getNet()")
        check(
            "两个客户端都已联机（各看到 1 个远端）",
            len(net1["remotes"]) == 1 and len(net2["remotes"]) == 1,
            f"p1 remotes={len(net1['remotes'])} p2 remotes={len(net2['remotes'])}",
        )
        check("站位号不重复", net1["slot"] != net2["slot"], f"slot {net1['slot']} / {net2['slot']}")

        await p1.wait("window.__PPR.getRace().state === 'Racing'", 15)
        await p2.wait("window.__PPR.getRace().state === 'Racing'", 15)
        check("服务器开跑令让两边同时进入 Racing", True)

        # ---------- 位置同步 ----------
        z_before = await p2.js("window.__PPR.getNet().remotes[0].z")
        await p1.js("window.__PPR.stepInput(0, 1, false, true)")
        await asyncio.sleep(1.0)
        await p1.js("window.__PPR.releaseInput()")
        await asyncio.sleep(0.35)
        z_after = await p2.js("window.__PPR.getNet().remotes[0].z")
        moved = abs(z_after - z_before) > 2.0
        check(
            "房主跑动被第二台机器看到（远端位置更新）",
            moved,
            f"z {z_before:.2f} -> {z_after:.2f}",
        )

        # ---------- 头顶昵称 + 血条 ----------
        tag1 = await p1.js("window.__PPR.getNameTag()")
        tag2 = await p2.js("window.__PPR.getNameTag()")
        check(
            "双方头顶昵称与本人大门填的一致",
            tag1 and tag1["text"] == "房主甲" and tag2 and tag2["text"] == "玩家乙" and tag1["visible"],
            json.dumps({"p1": tag1, "p2": tag2}, ensure_ascii=False),
        )
        hud = await p1.js(
            "(() => { const v = document.querySelector('.vitals'); "
            "return v ? v.textContent.replace(/\\s+/g, ' ').trim() : null; })()"
        )
        check("HUD 有血条（HP/100）与击杀数", hud is not None and "HP" in hud and "击杀" in hud, f"hud={hud}")

        st_before = await p2.js("window.__PPR.getStatus()")
        check("初始满血 100", st_before["hp"] == 100 and st_before["maxHp"] == 100, json.dumps(st_before))

        # ---------- 把两人摆到同一地点：轻击 3 次 = 102 伤害 → 死亡回起点 ----------
        # 角色朝向跟着水平速度走（站着不动只保留上一帧朝向），
        # 所以先让房主朝 +Z 跑一小段把身子转过去，再一起瞬移到位。
        await p1.js("window.__PPR.setOrbit(180, 9)")
        await p1.js("window.__PPR.stepInput(0, 1, false, false)")
        await asyncio.sleep(0.45)
        await p1.js("window.__PPR.releaseInput()")
        await p1.js("window.__PPR.teleport(0, 0.35, -30)")
        await p2.js("window.__PPR.teleport(1.0, 0.35, -28.8)")
        await asyncio.sleep(0.6)

        facing = await p1.js("window.__PPR.getPlayer().yaw")
        check("房主已经面向对手（朝向跟着移动走）", abs(abs(facing) - 3.14) < 0.3, f"yaw={facing:.2f}")
        check("开打前对面站着没被打", (await p2.js("window.__PPR.getSelfHits().knockdowns")) == 0)

        before_hits = (await p2.js("window.__PPR.getSelfHits()"))["knockdowns"]
        before_kills = (await p1.js("window.__PPR.getStatus()"))["kills"]
        before_plays = (await p1.js("window.__PPR.getSfx()"))["killPlays"]
        hp_trace = []
        for _ in range(3):
            # 每下之前把乙拉回攻击范围（轻击也会把对面推走一点）
            await p2.js("window.__PPR.teleport(1.0, 0.35, -28.8)")
            await asyncio.sleep(0.25)
            await p1.js("window.__PPR.attack('light')")
            await asyncio.sleep(0.6)
            hp_trace.append((await p2.js("window.__PPR.getStatus()"))["hp"])
        await asyncio.sleep(0.4)
        after_hits = (await p2.js("window.__PPR.getSelfHits()"))["knockdowns"]
        check(
            "轻击每下 -34（100 → 66 → 32）",
            hp_trace[:2] == [66, 32],
            f"hp={hp_trace}",
        )
        check("轻击三下打到 0 血", hp_trace[-1] == 0 or after_hits == before_hits + 1, f"hp={hp_trace}")

        st_after = await p2.js("window.__PPR.getStatus()")
        pos_after = await p2.js("window.__PPR.getPlayer()")
        check(
            "血量归零：回起点并回满 100",
            st_after["hp"] == 100 and st_after["deaths"] == 1 and abs(pos_after["z"] - 3.5) < 0.6,
            f"hp={st_after['hp']} deaths={st_after['deaths']} z={pos_after['z']:.2f}",
        )
        check("轻击三次仍然触发了倒地眩晕", after_hits == before_hits + 1, f"knockdowns {before_hits} -> {after_hits}")

        atk = await p1.js("window.__PPR.getStatus()")
        sfx = await p1.js("window.__PPR.getSfx()")
        check(
            "击杀者记 1 杀",
            atk["kills"] == before_kills + 1,
            f"kills {before_kills} -> {atk['kills']}",
        )
        check(
            "杀敌时真的调用了 1杀.mp3",
            sfx["killPlays"] == before_plays + 1 and sfx["src"].endswith("kill.mp3"),
            json.dumps(sfx, ensure_ascii=False),
        )
        await p1.shot(Path(args.out) / "perf_m7_online.png")

        # ---------- 重击 -70 ----------
        await asyncio.sleep(0.8)
        await p2.js("window.__PPR.teleport(1.0, 0.35, -28.8)")
        await asyncio.sleep(0.3)
        await p1.js("window.__PPR.attack('heavy')")
        await asyncio.sleep(1.3)
        hits = await p2.js("window.__PPR.getSelfHits()")
        stun = await p2.js("window.__PPR.getPlayer().stunned")
        st_heavy = await p2.js("window.__PPR.getStatus()")
        check("重击一次就让对面倒地眩晕", hits["knockdowns"] == 2 and stun is True, json.dumps(hits))
        check("重击 -70（满血 100 → 30）", st_heavy["hp"] == 30, f"hp={st_heavy['hp']}")

        await asyncio.sleep(1.1)

        # ---------- 答题中被重击打倒：中断答题 ----------
        await asyncio.sleep(1.1)
        # 先把乙回满血：30 血吃一发重击会直接死，死亡同样会中断答题，
        # 但这里要单独验证"被打倒"这条路径（血量不归零）
        await p2.js("window.__PPR.resetHealth()")
        await p2.js("window.__PPR.teleport(1.0, 0.35, -28.8)")
        await asyncio.sleep(0.35)
        await p2.js("window.__PPR.startQuiz(0)")
        await p2.wait("window.__PPR.getQuiz().phase === 'asking'", 6)
        await asyncio.sleep(0.2)
        await p1.js("window.__PPR.attack('heavy')")
        await asyncio.sleep(1.3)
        quiz = await p2.js("window.__PPR.getQuiz()")
        race = await p2.js("window.__PPR.getRace()")
        st_quiz = await p2.js("window.__PPR.getStatus()")
        check(
            "答题中被打倒会中断答题",
            quiz["phase"] == "off" and quiz["interrupted"] is True,
            f"phase={quiz['phase']} interrupted={quiz['interrupted']}",
        )
        check("中断后回到 Racing，题面不再占屏", race["state"] == "Racing", f"race={race['state']}")
        check(
            "这一下是打倒不是打死（血量 100 → 30）",
            st_quiz["hp"] == 30 and st_quiz["deaths"] == 1,
            f"hp={st_quiz['hp']} deaths={st_quiz['deaths']}",
        )
        await p2.shot(Path(args.out) / "perf_m7_quiz_interrupt.png")

        # ---------- 冲线：服务器计时 + 榜单 ----------
        await p1.js("window.__PPR.teleport(0, 0.35, -322)")
        await p1.wait("window.__PPR.getNet().finishSent === true", 8)
        await asyncio.sleep(1.6)
        await p2.js("window.__PPR.teleport(1.6, 0.35, -322)")
        await p2.wait("window.__PPR.getNet().finishSent === true", 8)
        await asyncio.sleep(1.4)

        board_rows = await p1.js(
            "(() => { const rows = document.querySelectorAll('.result .board .row'); "
            "return [...rows].map(r => r.textContent.replace(/\\s+/g, ' ').trim()); })()"
        )
        check(
            "结算面板列出两人成绩",
            isinstance(board_rows, list) and len(board_rows) == 2,
            json.dumps(board_rows, ensure_ascii=False),
        )
        times = await p1.js(
            "(() => { const rows = document.querySelectorAll('.result .board .row .row-time'); "
            "return [...rows].map(r => r.textContent.trim()); })()"
        )
        check(
            "成绩是服务器算的完赛时间（都有效）",
            isinstance(times, list) and len(times) == 2 and all(t not in ("未完成", "") for t in times),
            json.dumps(times, ensure_ascii=False),
        )

        kills_col = await p1.js(
            "(() => [...document.querySelectorAll('.result .board .row .row-kills')].map(e => e.textContent.trim()))()"
        )
        kills_nums = [int("".join(ch for ch in k if ch.isdigit()) or 0) for k in (kills_col or [])]
        check(
            "结算榜单带击杀列，且全场击杀数 > 0",
            isinstance(kills_col, list) and len(kills_col) == 2 and sum(kills_nums) >= 1,
            json.dumps(kills_col, ensure_ascii=False),
        )

        # ---------- 性能：双客户端仍在可玩帧率 ----------
        perf = await p1.js("window.__PPR.getPerf()")
        check(
            "双人联机下帧率仍 >= 30",
            perf["fps"] >= 30,
            f"fps={perf['fps']:.1f} p99={perf['p99Ms']:.1f} ms draw={perf['drawCalls']}",
        )

    finally:
        p1.close()
        p2.close()

    report = {
        "url": args.url,
        "collectedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "pass": failures == 0,
        "results": results,
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.json:
        Path(args.json).write_text(text, encoding="utf-8")
    print(text)
    return 0 if failures == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:5173/")
    parser.add_argument("--json", default="tools/verify_m7.json")
    parser.add_argument("--out", default="tools")
    args = parser.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
