#!/usr/bin/env python
"""B1.9：把真实障碍布局（ObstacleField.layoutBands）导出成 JSON，便于画俯视图。

用法：.venv\\Scripts\\python.exe tools\\dump_layout_b20.py [url]
输出：tools\\layout_b20.json
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

OUT = Path(__file__).parent / "layout_b20.json"


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_layout_profile_")
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
            ready = False
            deadline = time.time() + 90
            while time.time() < deadline:
                st = await cdp.eval_js("!!(window.__PPR && window.__PPR.ready)")
                if st:
                    ready = True
                    break
                await cdp.eval_js(ENTER_SOLO_JS)
                await asyncio.sleep(0.5)
            if not ready:
                raise SystemExit("页面未就绪")
            await cdp.eval_js("window.__PPR.clearTiles && window.__PPR.clearTiles()")
            data = await cdp.eval_js("JSON.stringify({layout: window.__PPR.getLayout(), " "gloves: window.__PPR.getGloves(), track: window.__PPR.getTrack()})")
        payload = json.loads(data)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"bands={len(payload['layout']['bands'])} conflicts={payload['layout']['conflicts']} -> {OUT.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
