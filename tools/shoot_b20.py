#!/usr/bin/env python
"""B2.0 截图：浮桥段（俯视 / 侧视 / 玩家视角）。

用法：.venv\\Scripts\\python.exe tools\\shoot_b20.py [url]
输出：tools\\b20_bridge_wide.png / b20_bridge_side.png / b20_bridge_play.png
"""
from __future__ import annotations

import asyncio
import base64
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from perf_probe import Cdp, ENTER_SOLO_JS, find_chrome, free_port, list_targets  # noqa: E402

OUT = Path(__file__).parent

SHOT_WIDE = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  P.clearTiles();
  const b = P.getBridge().platforms[1];
  P.teleport(b.x, 0.06, b.z);
  await sleep(500);
  P.setCamera([-13.5, 9.0, -134.0], [0.2, 0.1, -160.5]);
  await sleep(400);
  return P.getBridge().platforms.map((p) => p.x);
})()
"""

SHOT_TOP = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.setCamera([0.0, 27.0, -157.0], [0.0, 0.0, -158.2]);
  await sleep(400);
  return P.getBridge().platforms.map((p) => p.x);
})()
"""

SHOT_SIDE = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.setCamera([7.2, 2.6, -146.5], [0.0, 0.3, -159.0]);
  await sleep(400);
  return P.getPlayer();
})()
"""

SHOT_PLAY = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  const b = P.getBridge().platforms[2];
  P.teleport(b.x, 0.06, b.z);
  P.setOrbit(0, 11);
  await sleep(900);
  return P.getPlayer();
})()
"""


async def grab(cdp: Cdp, js: str, png: Path, wait_s: float = 0.25) -> None:
    await cdp.eval_js(js, timeout_s=30)
    await asyncio.sleep(wait_s)
    shot = await cdp.call("Page.captureScreenshot", {"format": "png"})
    png.write_bytes(base64.b64decode(shot["data"]))
    print(f"-> {png.name}")


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_b20_shot_")
    chrome = find_chrome()
    proc = subprocess.Popen(
        [
            chrome,
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
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
            targets = list_targets(port)
            page = next((t for t in targets if t.get("type") == "page"), None)
            if page:
                break
            time.sleep(0.5)
        if page is None:
            raise SystemExit("没有可用的页面目标")

        import websockets

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
            else:
                raise SystemExit("页面未就绪")

            await grab(cdp, SHOT_WIDE, OUT / "b20_bridge_wide.png", 0.6)
            await grab(cdp, SHOT_TOP, OUT / "b20_bridge_top.png", 0.6)
            await grab(cdp, SHOT_SIDE, OUT / "b20_bridge_side.png", 0.6)
            await grab(cdp, SHOT_PLAY, OUT / "b20_bridge_play.png", 0.6)
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
