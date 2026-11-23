"""Party Run 性能探针。

用临时 Chrome 实例 + CDP 读取页面内的 window.__PPR.getPerf()，输出真实 FPS/帧时间/绘制调用，
并抓一张截图。用于把实测数字回填 docs/PERFORMANCE.md。

用法（必须用项目 .venv 的 Python）：
  .venv\\Scripts\\python.exe tools\\perf_probe.py --url http://localhost:5173/
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


def free_port(start: int = 9333, span: int = 60) -> int:
    for port in range(start, start + span):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit("没有可用端口")


def list_targets(port: int, timeout: float = 20.0) -> list[dict]:
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/json/list"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, list):
                    return data
        except Exception:
            pass
        time.sleep(0.3)
    raise SystemExit("CDP 端口未就绪")


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

    async def eval_js(self, expression: str, timeout_s: float = 10.0):
        res = await self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
        )
        if res.get("exceptionDetails"):
            raise RuntimeError(f"JS 异常: {res['exceptionDetails']}")
        return res.get("result", {}).get("value")


RENDERER_JS = """(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return { webgl: false };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    webgl: true,
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
  };
})()"""


# 首页现在先过昵称门：填名字 → 点"进入游戏" → 点"单人游戏"，一步到位，
# 供探针与各验收脚本的等待循环复用（window.__PPR 只在进游戏后才存在）。
ENTER_SOLO_JS = """(() => {
  const gi = document.querySelector('.gate-input');
  if (gi && !gi.value) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(gi, '验收员');
    gi.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const go = document.querySelector('.gate-go');
  if (go && !go.disabled) go.click();
  const b = document.querySelector('.mode.solo');
  if (b) b.click();
  return !!(b && window.__PPR);
})()"""


async def run(args: argparse.Namespace) -> int:
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_probe_profile_")
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
            "--window-position=0,0",
            args.url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        targets = list_targets(port)
        page = next((t for t in targets if t.get("type") == "page" and args.url.split("//")[-1].split("/")[0] in t.get("url", "")), None)
        if page is None:
            page = next((t for t in targets if t.get("type") == "page"), None)
        if page is None:
            raise SystemExit("没有可用的页面目标")

        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=32 * 1024 * 1024) as ws:
            cdp = Cdp(ws)
            await cdp.call("Runtime.enable")
            await cdp.call("Page.enable")

            ready = False
            deadline = time.time() + args.ready_timeout
            error_detail = None
            while time.time() < deadline:
                state = await cdp.eval_js(
                    "(() => ({ ready: !!(window.__PPR && window.__PPR.ready), "
                    "err: (document.querySelector('.error') || {}).textContent || null }))()"
                )
                if state and state.get("ready"):
                    ready = True
                    break
                if state and state.get("err"):
                    error_detail = state["err"]
                    break
                # 首页先过昵称门再进单人局（只在还没进游戏时点）
                await cdp.eval_js(ENTER_SOLO_JS)
                await asyncio.sleep(0.5)

            if not ready:
                raise SystemExit(f"页面未就绪：{error_detail or '超时未出现 window.__PPR'}")

            # 赛道铺满随机方格陷阱：性能采样期间不希望赛道随机塌陷，先全部变回实心
            await cdp.eval_js("window.__PPR.clearTiles && window.__PPR.clearTiles()")

            renderer = await cdp.eval_js(RENDERER_JS)

            if args.eval_js:
                await cdp.eval_js(args.eval_js)
                await asyncio.sleep(0.4)

            samples = []
            end = time.time() + args.duration
            while time.time() < end:
                snap = await cdp.eval_js("window.__PPR.getPerf()")
                if isinstance(snap, dict):
                    samples.append(snap)
                await asyncio.sleep(args.interval)

            final = samples[-1] if samples else {}
            shot = await cdp.call("Page.captureScreenshot", {"format": "png"})
            if args.png:
                Path(args.png).write_bytes(base64.b64decode(shot["data"]))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    report = {
        "url": args.url,
        "collectedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "webgl": renderer,
        "perf": final,
        "samples": samples,
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.json:
        Path(args.json).write_text(text, encoding="utf-8")
    print(text)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:5173/")
    parser.add_argument("--duration", type=float, default=8.0, help="采样秒数")
    parser.add_argument("--interval", type=float, default=0.5, help="采样间隔")
    parser.add_argument("--ready-timeout", type=float, default=30.0)
    parser.add_argument("--json", default="")
    parser.add_argument("--png", default="")
    parser.add_argument("--eval-js", default="", help="页面就绪后执行的 JS，例如调试取景")
    args = parser.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
