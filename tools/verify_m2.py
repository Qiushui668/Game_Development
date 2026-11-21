"""M2 手感自动化验收。

用临时 Chrome + CDP 打开开发服务器，通过 window.__PPR 的调试钩子注入移动意图，
测出实际跑速、跳跃高度/滞空、坡道爬升与掉落后复活。

用法：.venv\\Scripts\\python.exe tools\\verify_m2.py
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

from perf_probe import Cdp, find_chrome, free_port, list_targets  # noqa: E402

MEASURE_JS = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  // ---------- 1. 前进速度 ----------
  P.releaseInput();
  P.teleport(0, 0.35, 3.5);
  await sleep(300);
  const idle = P.getPlayer();

  P.stepInput(0, 1, false, false);
  await sleep(500);
  const mid = P.getPlayer();
  await sleep(900);
  const walk = P.getPlayer();
  out.walk = {
    speed: walk.speed,
    dz: walk.z - idle.z,
    grounded: walk.grounded,
    accel: mid.speed,
  };

  // ---------- 2. 冲刺速度 ----------
  P.stepInput(0, 1, false, true);
  await sleep(900);
  const sprint = P.getPlayer();
  out.sprint = { speed: sprint.speed };

  // ---------- 3. 跳跃高度与滞空 ----------
  P.releaseInput();
  P.teleport(0, 0.05, 3.5);
  await sleep(400);
  const before = P.getPlayer();
  const t0 = performance.now();
  P.stepInput(0, 0, true, false);
  let maxY = before.y;
  let airtime = 0;
  let landed = false;
  while (performance.now() - t0 < 1400) {
    const s = P.getPlayer();
    if (s.y > maxY) maxY = s.y;
    if (!landed && s.grounded && performance.now() - t0 > 60) {
      airtime = performance.now() - t0;
      landed = true;
      break;
    }
    await sleep(16);
  }
  out.jump = { height: maxY - before.y, airtimeMs: airtime, landed };

  // ---------- 4. 跑跳跳距 ----------
  P.releaseInput();
  P.teleport(0, 0.05, 3.5);
  await sleep(400);
  P.stepInput(0, 1, false, false);
  await sleep(700);
  const runStart = P.getPlayer();
  P.stepInput(0, 1, true, false);
  let leftGround = false;
  let landing = null;
  const t1 = performance.now();
  while (performance.now() - t1 < 1600) {
    const s = P.getPlayer();
    if (!leftGround && !s.grounded) leftGround = true;
    if (leftGround && s.grounded) { landing = s; break; }
    await sleep(16);
  }
  out.longJump = landing
    ? { distance: runStart.z - landing.z, speed: runStart.speed, airMs: performance.now() - t1 }
    : null;

  // ---------- 4.5 坡面静置采样（检查角色是否浮在坡面上） ----------
  P.releaseInput();
  P.teleport(0, 0.05, -62);
  await sleep(700);
  const rampAt62 = P.getPlayer();
  P.teleport(0, 1.2, -65);
  await sleep(700);
  const rampAt65 = P.getPlayer();
  out.rampSurface = { at62: rampAt62.y, at65: rampAt65.y };

  // ---------- 5. 坡道 ----------
  P.releaseInput();
  P.teleport(0, 0.45, -58);
  await sleep(300);
  P.stepInput(0, 1, false, false);
  let peakY = 0;
  const t2 = performance.now();
  while (performance.now() - t2 < 1800) {
    const s = P.getPlayer();
    if (s.y > peakY) peakY = s.y;
    await sleep(16);
  }
  const afterRamp = P.getPlayer();
  out.ramp = { peakY, endY: afterRamp.y, endZ: afterRamp.z };

  // ---------- 6. 栏架碰撞（z=-82 那排正中是实心的） ----------
  P.releaseInput();
  P.teleport(0, 0.1, -76);
  await sleep(300);
  P.stepInput(0, 1, false, false);
  await sleep(1400);
  const blocked = P.getPlayer();
  out.hurdleBlock = { z: blocked.z, speed: blocked.speed };

  // ---------- 7. 掉落复活 ----------
  P.releaseInput();
  P.teleport(0, -12, -20);
  await sleep(600);
  const respawned = P.getPlayer();
  out.respawn = { y: respawned.y, z: respawned.z, grounded: respawned.grounded };

  P.releaseInput();
  P.teleport(0, 0.05, 3.5);
  return out;
})()
"""


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_verify_")
    proc = subprocess.Popen(
        [
            find_chrome(),
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--window-size=1280,760",
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        targets = list_targets(port)
        page = next((t for t in targets if t.get("type") == "page"), None)
        if page is None:
            raise SystemExit("找不到页面目标")

        from websockets import connect

        async with connect(page["webSocketDebuggerUrl"], max_size=16 * 1024 * 1024) as ws:
            cdp = Cdp(ws)
            await cdp.call("Runtime.enable")

            deadline = time.time() + 30
            while time.time() < deadline:
                ready = await cdp.eval_js("!!(window.__PPR && window.__PPR.stepInput)")
                if ready:
                    break
                await asyncio.sleep(0.5)
            else:
                raise SystemExit("页面未就绪")

            await asyncio.sleep(0.6)
            result = await cdp.eval_js(MEASURE_JS, timeout_s=30)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
