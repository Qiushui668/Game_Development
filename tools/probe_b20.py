#!/usr/bin/env python
"""B2.0 探针：浮桥 / 挖空段 / 站立跟随 / 自机配色一致性。

用法：.venv\\Scripts\\python.exe tools\\probe_b20.py [url]
"""
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

JS = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  P.clearTiles();

  out.layout = { conflicts: P.getLayout().conflicts, holeConflicts: P.getLayout().bridgeHoleConflicts };
  const bridge = P.getBridge();
  out.bridge = { count: bridge.count, size: bridge.size, gap: bridge.gap, amp: bridge.amplitudeX, period: bridge.periodSeconds };
  out.plat0 = bridge.platforms[0];
  out.plat1 = bridge.platforms[1];
  out.own = P.getOwnColor();
  out.localColor = localStorage.getItem('ppr:color');

  // 挖空段：格子在 -142…-175 之间应该都没有碰撞
  const tiles = P.getTiles().tiles;
  const gapTiles = tiles.filter((t) => t.gap);
  out.gapTiles = {
    count: gapTiles.length,
    allAir: gapTiles.every((t) => t.solid === false),
    zMin: Math.min(...gapTiles.map((t) => t.z)),
    zMax: Math.max(...gapTiles.map((t) => t.z)),
  };

  // 掉进挖空段：回起点 + 死亡 +1
  const d0 = P.getStatus().deaths ?? P.getStatus().deathCount ?? 0;
  P.teleport(0, 0.05, -150);
  await sleep(2600);
  const afterFall = P.getPlayer();
  out.fell = { z: afterFall.z, hp: P.getStatus().hp, deaths: P.getStatus().deaths ?? P.getStatus().deathCount ?? 0, d0 };

  // 站上第 3 块板：跟着一起横向走
  const b = P.getBridge().platforms;
  const target = b[2];
  P.teleport(target.x, 0.06, target.z);
  await sleep(400);
  const sampleA = { p: P.getPlayer(), plat: P.getBridge().platforms[2].x };
  for (let i = 0; i < 40; i++) await sleep(50);
  const sampleB = { p: P.getPlayer(), plat: P.getBridge().platforms[2].x };
  out.stand = {
    yA: sampleA.p.y,
    yB: sampleB.p.y,
    zA: sampleA.p.z,
    zB: sampleB.p.z,
    platMove: sampleB.plat - sampleA.plat,
    driftA: sampleA.p.x - sampleA.plat,
    driftB: sampleB.p.x - sampleB.plat,
    grounded: sampleB.p.grounded,
  };

  P.teleport(0, 0.05, 3.5);
  await sleep(300);
  return out;
})()
"""


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_b20_probe_")
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
            data = await cdp.eval_js(JS)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
