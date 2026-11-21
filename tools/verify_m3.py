"""M3 障碍碰撞 + 击退 + 关卡长度自动化验收。

依赖 window.__PPR 的调试钩子：
  getTrack()        读赛道长度/终点
  getObstacles()    读扫地杆/滚轴的实时角度
  teleport/stepInput 摆位与注入输入

用法：.venv\\Scripts\\python.exe tools\\verify_m3.py
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
  // M3 加了 3 秒起跑倒数，验收直接跳过
  if (P.startNow) P.startNow();
  await sleep(150);

  // ---------- 1. 关卡长度 ----------
  const track = P.getTrack();
  out.track = track;
  out.finishDistance = Math.abs(track.spawnZ - track.finishZ);

  // ---------- 2. 扫地杆扫中（站在第一根摆臂的扫掠线上，等它转过来） ----------
  P.releaseInput();
  P.teleport(0, 0.05, -22);
  await sleep(250);
  const stand = P.getPlayer();
  let hitMs = null;
  let hitSpeed = null;
  let hitPos = null;
  const t0 = performance.now();
  while (performance.now() - t0 < 6500) {
    const s = P.getPlayer();
    if (s.stunned) {
      hitMs = performance.now() - t0;
      hitSpeed = s.speed;
      hitPos = s;
      break;
    }
    await sleep(16);
  }
  await sleep(900);
  const afterSweep = P.getPlayer();
  out.sweeper = {
    waitMs: hitMs,
    stunSpeed: hitSpeed,
    moved: hitPos ? Math.hypot(afterSweep.x - hitPos.x, afterSweep.z - hitPos.z) : 0,
    stillStunned: afterSweep.stunned,
    startZ: stand.z,
    endZ: afterSweep.z,
    endX: afterSweep.x,
  };

  // ---------- 3. 硬直结束后输入恢复 ----------
  P.stepInput(0, 1, false, true);
  await sleep(800);
  const resumed = P.getPlayer();
  out.recover = { speed: resumed.speed, stunned: resumed.stunned };

  // ---------- 4. 滚轴把人顶回去 ----------
  P.releaseInput();
  P.teleport(0, 0.05, -46);
  await sleep(70);
  const r0 = P.getPlayer();
  await sleep(520);
  const r1 = P.getPlayer();
  out.roller = {
    stunnedAtStart: r0.stunned,
    dz: r1.z - r0.z,
    dx: r1.x - r0.x,
    speed: r1.speed,
  };

  // ---------- 5. 障碍数量与角度在推进 ----------
  const ob0 = P.getObstacles();
  await sleep(600);
  const ob1 = P.getObstacles();
  out.obstacles = {
    sweepers: ob0.sweeperAngles.length,
    rollers: ob0.rollAngles.length,
    angleAdvanced: Math.abs(ob1.sweeperAngles[0] - ob0.sweeperAngles[0]),
  };

  // ---------- 6. 冲线 → 结算态 ----------
  async function runToFinish() {
    P.releaseInput();
    P.teleport(0, 0.1, -316);
    await sleep(220);
    P.stepInput(0, 1, false, true);
    const t = performance.now();
    while (performance.now() - t < 6000) {
      if (P.getRace().state === 'Result') break;
      await sleep(16);
    }
    P.releaseInput();
    return P.getRace();
  }

  const firstFinish = await runToFinish();
  out.finish = {
    state: firstFinish.state,
    finishMs: firstFinish.finishMs,
    progress: firstFinish.progress,
    remaining: firstFinish.remaining,
  };

  // ---------- 7. 重开一局：倒数 → Racing，计时归零 ----------
  P.restartRace();
  await sleep(180);
  const afterRestart = P.getRace();
  const playerAfterRestart = P.getPlayer();
  out.restart = {
    state: afterRestart.state,
    countdown: afterRestart.countdown,
    elapsedMs: afterRestart.elapsedMs,
    playerZ: playerAfterRestart.z,
    playerGroundedY: playerAfterRestart.y,
  };

  // ---------- 8. 第二局计时从 0 起算 ----------
  if (P.startNow) P.startNow();
  await sleep(150);
  const secondFinish = await runToFinish();
  out.secondRun = {
    state: secondFinish.state,
    finishMs: secondFinish.finishMs,
    bestMs: secondFinish.bestMs,
    elapsedAtFinish: secondFinish.elapsedMs,
  };

  P.releaseInput();
  return out;
})()
"""


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_verify3_")
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
                # B 阶段起首页先展示：自动化从"单人游戏"点进去
                await cdp.eval_js(
                    "(() => { const b = document.querySelector('.mode.solo'); if (b) b.click(); return !!b; })()"
                )
                ready = await cdp.eval_js("!!(window.__PPR && window.__PPR.getObstacles)")
                if ready:
                    break
                await asyncio.sleep(0.5)
            else:
                raise SystemExit("页面未就绪")

            await asyncio.sleep(0.6)
            result = await cdp.eval_js(MEASURE_JS, timeout_s=40)
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
