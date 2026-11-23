"""B2.0 三条需求验收（真浏览器跑 UI）。

1) 单人结算页：除「再跑一次」外还有「返回房间」，点了回首页
2) 配色：自己看到的身体颜色 == 联机里别人看到的 == 昵称门选的；没选过则随机一个（落在 8 色板内）
3) 浮桥：答题墙 2 → 3 之间是 6 块左右摆动的浮桥，踩空掉虚空回起点

用法（必须用项目 .venv 的 Python）：
  .venv\\Scripts\\python.exe tools\\verify_b20.py
前置：Vite http://localhost:5173，房间服务 ws://localhost:8000/ws。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from verify_m7 import Page, click, free_port, open_page, set_input, wait_game_ready  # noqa: E402

PALETTE = [
    "#ff3f8b",
    "#22d0c8",
    "#7a5cff",
    "#35e07a",
    "#ff8a3d",
    "#3fb6ff",
    "#ffd23f",
    "#d24bff",
]


def hexnum(text: str) -> int:
    return int(str(text).lstrip("#"), 16)


GATE_INFO = """(() => ({
  swatches: [...document.querySelectorAll('.gate-colors .swatch:not(.random)')].map(e => e.getAttribute('aria-label')),
  random: (document.querySelector('.swatch.random') || {}).textContent || '',
  tip: (document.querySelector('.gate-tip') || {}).textContent || '',
  modes: document.querySelectorAll('.mode').length,
}))()"""

GO_GATE = """(name) => {
  const gi = document.querySelector('.gate-input');
  if (!gi) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(gi, name);
  gi.dispatchEvent(new Event('input', { bubbles: true }));
  const go = document.querySelector('.gate-go');
  if (go && !go.disabled) { go.click(); return true; }
  return false;
}"""

PICK_SWATCH = """(idx) => {
  const list = [...document.querySelectorAll('.gate-colors .swatch:not(.random)')];
  if (!list[idx]) return false;
  list[idx].click();
  return list[idx].getAttribute('aria-label');
}"""

RESULT_BUTTONS = """(() => [...document.querySelectorAll('.result .actions button')].map(e => e.textContent.trim()))()"""

SWING_JS = """(async (ms) => {
  const P = window.__PPR;
  const out = [];
  const until = performance.now() + ms;
  while (performance.now() < until) {
    out.push(P.getBridge().platforms.map(p => ({ x: p.x, cx: p.cx, z: p.z })));
    await new Promise(r => setTimeout(r, 250));
  }
  return out;
})"""

CARRY_JS = """(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const b = P.getBridge().platforms[2];
  P.teleport(b.x, 0.06, b.z);
  await sleep(400);
  const p0 = P.getPlayer(); const x0 = P.getBridge().platforms[2].x;
  for (let i = 0; i < 50; i++) await sleep(50);
  const p1 = P.getPlayer(); const x1 = P.getBridge().platforms[2].x;
  return { y0: p0.y, y1: p1.y, z0: p0.z, z1: p1.z, platMove: x1 - x0, drift0: p0.x - x0, drift1: p1.x - x1, grounded: p1.grounded };
})"""

FALL_JS = """(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const d0 = P.getStatus().deaths;
  P.teleport(0, 0.05, -148);
  await sleep(2600);
  const p = P.getPlayer();
  return { z: p.z, x: p.x, deaths: P.getStatus().deaths, d0, hp: P.getStatus().hp };
})"""


async def run(args: argparse.Namespace) -> int:
    results: list[dict] = []
    failures = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failures
        results.append({"name": name, "ok": bool(ok), "detail": detail})
        if not ok:
            failures += 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}".rstrip(), flush=True)

    p1 = await open_page(free_port(9501), args.url, "0,0", "1100,720", "p1")
    p2: Page | None = None
    try:
        await p1.wait("!!document.querySelector('.gate')", 25)
        gate = await p1.js(GATE_INFO)
        check("昵称门有 8 个色板 + 随机按钮", len(gate["swatches"]) == 8 and "随机" in gate["random"], json.dumps(gate, ensure_ascii=False))
        check("没选配色时提示文案说明会随机", "随机" in gate["tip"], gate["tip"])
        check("未确认昵称前不给入口", gate["modes"] == 0, f"modes={gate['modes']}")
        await p1.shot(Path(args.out) / "perf_b20_gate.png")

        # ---------- 需求 2：没选配色 → 随机一个，自己/名牌/存档一致 ----------
        await set_input(p1, ".gate-input", "验收员")
        await asyncio.sleep(0.25)
        await click(p1, ".gate-go")
        await p1.wait("!!document.querySelector('.mode.solo')", 8)
        stored = await p1.js("window.localStorage.getItem('ppr:color')")
        check("没选配色也会被分到一个颜色（写进记忆）", bool(stored), f"stored={stored}")
        check("随机色落在 8 色板内", stored in PALETTE, f"stored={stored} swatches={gate['swatches']}")

        await click(p1, ".mode.solo")
        await p1.wait("!!(window.__PPR && window.__PPR.ready)", 40)
        await p1.js("window.__PPR.clearTiles && window.__PPR.clearTiles()")
        own = await p1.js("window.__PPR.getOwnColor()")
        check(
            "自机身体色 == 头顶名牌色 == 存档色",
            own["body"] == own["hex"] == hexnum(own["nameTag"]) == hexnum(stored),
            json.dumps(own),
        )

        # ---------- 需求 3：浮桥 ----------
        layout = await p1.js("window.__PPR.getLayout()")
        bridge = await p1.js("window.__PPR.getBridge()")
        check("障碍布局与浮桥段无重叠", layout["conflicts"] == [], json.dumps(layout["conflicts"], ensure_ascii=False))
        check("没有障碍悬在浮桥挖空段上", layout["bridgeHoleConflicts"] == [], json.dumps(layout["bridgeHoleConflicts"], ensure_ascii=False))
        check("浮桥正好 6 块", bridge["count"] == 6, f"count={bridge['count']}")
        zs = [p["z"] for p in bridge["platforms"]]
        check(
            "6 块浮桥排在答题墙 2(-136) → 3(-196) 之间",
            max(zs) < -136 and min(zs) > -196 and all(abs(b - a) > 4.4 for a, b in zip(zs, zs[1:])),
            json.dumps([round(z, 1) for z in zs]),
        )
        gap = await p1.js(
            "(() => { const t = window.__PPR.getTiles().tiles.filter(t => t.gap);"
            " return { n: t.length, air: t.every(t => !t.solid), zMin: Math.min(...t.map(t => t.z)), zMax: Math.max(...t.map(t => t.z)) }; })()"
        )
        check(
            "挖空段方格全部没有碰撞（掉下去就是虚空）",
            gap["n"] == 66 and gap["air"] is True and gap["zMin"] <= -173 and gap["zMax"] >= -144,
            json.dumps(gap),
        )
        check(
            "方格总数仍是 684（挖空不减少棋盘）",
            (await p1.js("window.__PPR.getTiles().tiles.length")) == 684,
            "",
        )

        swing = await p1.js(f"({SWING_JS})(5400)")
        amp = [max(abs(row[i]["x"] - row[i]["cx"]) for row in swing) for i in range(len(swing[0]))]
        check(
            "6 块浮桥都在横向左右摆（一个周期内摆幅 > 1.5 m）",
            all(a > 1.5 for a in amp),
            json.dumps([round(a, 2) for a in amp]),
        )
        check(
            "摆幅不超过设定的 ±1.9 m",
            all(a <= 1.9 + 0.25 for a in amp) and all(a > 0.5 for a in amp),
            f"max={max(amp):.2f}",
        )
        lat = [max(abs(row[i]["x"] - row[i + 1]["x"]) for row in swing) for i in range(len(swing[0]) - 1)]
        check(
            "相邻两块横向错位 ≤ 3.1 m（一跳够得着）",
            max(lat) <= 3.1,
            json.dumps([round(v, 2) for v in lat]),
        )

        carry = await p1.js(f"({CARRY_JS})()")
        check(
            "站在浮桥上会被一起带走（不原地掉下去）",
            abs(carry["platMove"]) > 1.2
            and abs(carry["drift1"]) < 0.5
            and 0.0 <= carry["y1"] <= 0.3
            and carry["grounded"] is True,
            json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in carry.items()}),
        )

        fall = await p1.js(f"({FALL_JS})()")
        check(
            "踩空掉进挖空段 → 回到起点并满血",
            abs(fall["z"] - 3.5) < 1.0 and fall["hp"] == 100 and fall["deaths"] == fall["d0"] + 1,
            json.dumps(fall),
        )
        await p1.shot(Path(args.out) / "perf_b20_bridge.png")

        # ---------- 需求 1：单人结算双按钮 ----------
        await p1.js("window.__PPR.teleport(0, 0.05, -330)")
        await p1.wait("window.__PPR.getRace().state === 'Result'", 20)
        await p1.wait("document.querySelectorAll('.result .actions button').length === 2", 8)
        buttons = await p1.js(RESULT_BUTTONS)
        check(
            "单人结算页有「返回房间」和「再跑一次」两个按钮",
            buttons == ["返回房间", "再跑一次"],
            json.dumps(buttons, ensure_ascii=False),
        )
        await p1.shot(Path(args.out) / "perf_b20_solo_result.png")
        await click(p1, ".result .actions .ghost")
        await p1.wait("!!document.querySelector('.mode.solo')", 12)
        back = await p1.js("(() => ({ modes: document.querySelectorAll('.mode').length, gate: !!document.querySelector('.gate') }))()")
        check("点「返回房间」回到首页（能重新选单人/多人）", back["modes"] == 2, json.dumps(back))

        # ---------- 需求 2：双客户端互相看到的颜色一致 ----------
        await click(p1, ".whoami .relink")
        await p1.wait("!!document.querySelector('.gate-input')", 8)
        mine = await p1.js(f"({PICK_SWATCH})(3)")
        check("首页选的第 4 个色板生效", mine == PALETTE[3], f"mine={mine}")
        await set_input(p1, ".gate-input", "验收员")
        await asyncio.sleep(0.25)
        await click(p1, ".gate-go")
        await p1.wait("!!document.querySelector('.mode.online')", 8)
        check(
            "改配色后存档跟着变",
            (await p1.js("window.localStorage.getItem('ppr:color')")) == PALETTE[3],
            await p1.js("window.localStorage.getItem('ppr:color')") or "",
        )

        p2 = await open_page(free_port(9561), args.url, "1100,0", "1100,720", "p2")
        await p2.wait("!!document.querySelector('.gate')", 25)
        theirs = await p2.js(f"({PICK_SWATCH})(5)")
        check("第二台机器选第 6 个色板", theirs == PALETTE[5], f"theirs={theirs}")
        await set_input(p2, ".gate-input", "玩家乙")
        await asyncio.sleep(0.25)
        await click(p2, ".gate-go")
        await p2.wait("!!document.querySelector('.mode.online')", 8)

        await click(p1, ".mode.online")
        await p1.wait("!!document.querySelector('.multi')", 6)
        await click(p1, ".col.create .primary")
        code = await p1.wait(
            "(() => { const e = document.querySelector('.lobby .code');"
            " return e && /^\\d{4}$/.test(e.textContent.trim()) ? e.textContent.trim() : false; })()",
            10,
        )
        await click(p2, ".mode.online")
        await p2.wait("!!document.querySelector('.col.join input.code')", 6)
        await set_input(p2, ".col.join input.code", str(code))
        await click(p2, ".col.join .primary")
        await p2.wait("!!document.querySelector('.lobby')", 10)
        await p1.wait(
            "(() => { const c = document.querySelector('.lobby .count');"
            " return c && c.textContent.includes('2 /') ? true : false; })()",
            10,
        )
        await click(p1, ".lobby .start")
        await asyncio.gather(wait_game_ready(p1), wait_game_ready(p2))
        await p1.wait("window.__PPR.getRace().state === 'Racing'", 20)
        await p2.wait("window.__PPR.getRace().state === 'Racing'", 20)

        o1 = await p1.js("window.__PPR.getOwnColor()")
        o2 = await p2.js("window.__PPR.getOwnColor()")
        r1 = await p1.js("window.__PPR.getRemoteColors()")
        r2 = await p2.js("window.__PPR.getRemoteColors()")
        check(
            "房主自机颜色 = 自己选的色（不是写死的青色）",
            o1["body"] == hexnum(PALETTE[3]) == hexnum(o1["nameTag"]),
            json.dumps(o1),
        )
        check(
            "第二台机器看到的房主颜色 = 房主自己选的色",
            len(r2) == 1 and r2[0]["body"] == hexnum(PALETTE[3]),
            json.dumps(r2),
        )
        check(
            "房主看到的第二人颜色 = 第二人自己选的色",
            len(r1) == 1 and r1[0]["body"] == hexnum(PALETTE[5]),
            json.dumps(r1),
        )
        check(
            "第二人自机颜色 = 自己选的色",
            o2["body"] == hexnum(PALETTE[5]) == hexnum(o2["nameTag"]),
            json.dumps(o2),
        )
        await p1.shot(Path(args.out) / "perf_b20_multi_p1.png")
        await p2.shot(Path(args.out) / "perf_b20_multi_p2.png")

        # 联机里也验一遍浮桥（不是只有单机才有）
        await p1.js("window.__PPR.teleport(0, 0.05, -148)")
        await asyncio.sleep(2.6)
        mp = await p1.js("(() => ({ z: window.__PPR.getPlayer().z, hp: window.__PPR.getStatus().hp }))()")
        check("联机里踩空浮桥同样回起点满血", abs(mp["z"] - 3.5) < 1.2 and mp["hp"] == 100, json.dumps(mp))
    finally:
        p1.close()
        if p2 is not None:
            p2.close()

    out = Path(args.out) / "verify_b20.json"
    out.write_text(json.dumps({"results": results, "failed": failures}, ensure_ascii=False, indent=2), encoding="utf-8")
    total = len(results)
    print(f"\n{total - failures}/{total} PASS", flush=True)
    return 0 if failures == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173")
    ap.add_argument("--out", default=str(Path(__file__).parent))
    return asyncio.run(run(ap.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
