#!/usr/bin/env python
"""把本地 HTML 整页截成 PNG（用 CDP 的 captureBeyondViewport）。"""
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
from perf_probe import Cdp, find_chrome, free_port, list_targets  # noqa: E402

import websockets


async def main(url: str, out: str, width: int) -> int:
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_shot_profile_")
    proc = subprocess.Popen(
        [
            find_chrome(),
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--hide-scrollbars",
            f"--window-size={width},1200",
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
        if page is None:
            raise SystemExit("no page")
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024) as ws:
            cdp = Cdp(ws)
            await cdp.call("Page.enable")
            await cdp.call("Runtime.enable")
            await asyncio.sleep(1.0)
            metrics = await cdp.call("Page.getLayoutMetrics")
            css = metrics.get("cssContentSize") or metrics.get("contentSize")
            # Chrome 的 cssContentSize 至少返回视口大小，页面比视口矮时会把空白一起截进来；
            # 用 body 实际尺寸兜底，避免图下方出现大片空白。
            real = await cdp.eval_js(
                "(() => { const kids = [...document.body.children];"
                " const bottom = kids.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);"
                " const right = kids.reduce((m, e) => Math.max(m, e.getBoundingClientRect().right), 0);"
                " return { w: Math.ceil(right), h: Math.ceil(bottom) }; })()",
                timeout_s=10,
            )
            w = int(real["w"]) if real and real.get("w") else int(css["width"])
            h = int(real["h"]) + 5 if real and real.get("h") else int(css["height"]) + 8
            shot = await cdp.call(
                "Page.captureScreenshot",
                {
                    "format": "png",
                    "captureBeyondViewport": True,
                    "clip": {"x": 0, "y": 0, "width": w, "height": h, "scale": 1},
                },
            )
            Path(out).write_bytes(base64.b64decode(shot["data"]))
            print(f"shot {int(css['width'])}x{h} -> {out}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)
    return 0


if __name__ == "__main__":
    url = sys.argv[1]
    out = sys.argv[2]
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 980
    raise SystemExit(asyncio.run(main(url, out, width)))
