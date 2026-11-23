#!/usr/bin/env python
"""排查 m9 回弹初速用例：在 z=-8、x=1.5 推人 +z 31 m/s，逐帧采样看是哪儿多飞了。"""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from perf_probe import Cdp, ENTER_SOLO_JS, find_chrome, free_port, list_targets  # noqa: E402
import websockets

SETUP = r"""
(() => {
  const P = window.__PPR;
  P.clearTiles && P.clearTiles();
  P.resetHealth();
  P.teleport(1.5, 0.05, -8);
  return { gloves: P.getGloves().stations.map(s => ({ z: +s.z.toFixed(2), e: +s.extend.toFixed(2), fist: { x: +s.fist.x.toFixed(2), z: +s.fist.z.toFixed(2) } })) };
})()"""

STEP = r"""
(() => {
  const P = window.__PPR;
  const s = P.getPlayer(); const t = P.getStatus();
  const g = P.getGloves().stations.map(x => ({ z: +x.z.toFixed(2), e: +x.extend.toFixed(2) }));
  return { z: +s.z.toFixed(2), x: +s.x.toFixed(2), hp: t.hp, deaths: t.deaths, sp: +s.speed.toFixed(2), st: s.stunned, g };
})()"""


async def main() -> int:
    url = "http://localhost:5173"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_push_profile_")
    proc = subprocess.Popen(
        [
            find_chrome(),
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--window-size=1280,760",
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        page = None
        t0 = time.time()
        while time.time() - t0 < 20:
            page = next((t for t in list_targets(port) if t.get("type") == "page"), None)
            if page:
                break
            time.sleep(0.4)
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=32 * 1024 * 1024) as ws:
            cdp = Cdp(ws)
            await cdp.call("Runtime.enable")
            await cdp.call("Page.enable")
            deadline = time.time() + 90
            while time.time() < deadline:
                if await cdp.eval_js("!!(window.__PPR && window.__PPR.ready)"):
                    break
                await cdp.eval_js(ENTER_SOLO_JS)
                await asyncio.sleep(0.5)
            print("setup", json.dumps(await cdp.eval_js(SETUP), ensure_ascii=False))
            await asyncio.sleep(0.25)
            push = await cdp.eval_js("window.__PPR.pushPlayer(0, 1, 31, 12, 1.5)")
            print("push", push)
            rows = []
            for i in range(20):
                await asyncio.sleep(0.1)
                rows.append(await cdp.eval_js(STEP))
            for r in rows:
                print(json.dumps(r, ensure_ascii=False))
            print("final dist", json.dumps(await cdp.eval_js("(()=>{const s=window.__PPR.getPlayer();return {x:+s.x.toFixed(2),z:+s.z.toFixed(2)}})()"), ensure_ascii=False))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
