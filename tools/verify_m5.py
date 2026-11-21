"""M4 攻击功能自动化验收（鼠标左键轻击 / 右键重击）。

覆盖：
  1. HUD 出现"左键 轻击 · 右键 重击"提示
  2. 轻击：能起手、单臂抡到 -1.9 rad 左右、出招期间不能再出招、0.36 s 后恢复可出招
  3. 重击：双臂举到 -2.55 rad（约 0.9 s 举满），1.55 s 收完
  4. 规则：轻击 3 次击倒并清零、重击 1 次击倒、倒地眩晕 1 s
  5. 连击窗口：轻击间隔超过 1.6 s 则计数清零，打不满 3 次
  6. 出招不锁移动：重击读条期间仍能向前跑
  7. 答题 Paused 期间不能出招

用法：.venv\\Scripts\\python.exe tools\\verify_m5.py [url]
"""

from __future__ import annotations

import asyncio
import base64
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from perf_probe import Cdp, find_chrome, free_port, list_targets  # noqa: E402

OUT_DIR = Path(__file__).parent

MEASURE_JS = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  P.releaseInput();
  if (P.startNow) P.startNow();
  await sleep(250);

  // ---------- 1. HUD 操作提示 ----------
  const hint = document.querySelector('.controls');
  out.hudHint = hint ? hint.textContent.replace(/\s+/g, ' ').trim() : null;

  // ---------- 2. 轻击 ----------
  const idleArm = P.getAttack().armX;
  const t0 = performance.now();
  const started = P.attack('light');
  const busyReject = !P.attack('heavy');       // 出招期间不允许再出招
  let maxL = 0;
  let maxR = 0;
  let maxLz = 0;
  let maxRz = 0;
  const phases = [];
  for (let i = 0; i < 20; i++) {
    await sleep(22);
    const a = P.getAttack();
    phases.push(a.phase);
    if (a.armX) {
      maxL = Math.max(maxL, a.armX.leftX);
      maxR = Math.max(maxR, a.armX.rightX);
      maxLz = Math.max(maxLz, Math.abs(a.armX.leftZ));
      maxRz = Math.max(maxRz, Math.abs(a.armX.rightZ));
    }
  }
  await sleep(120);
  out.light = {
    started,
    busyReject,
    idleLeftX: idleArm && idleArm.leftX,
    maxLeftX: maxL,
    maxRightX: maxR,
    maxLeftZ: maxLz,
    maxRightZ: maxRz,
    swingMs: Math.round(performance.now() - t0),
    phases: [...new Set(phases)],
    canActAfter: P.getAttack().canAct,
  };

  // ---------- 3. 重击：双臂举满再砸下 ----------
  const heavyStart = performance.now();
  const heavyStarted = P.attack('heavy');
  let peakX = 0;
  let peakZ = 0;
  let at900 = null;
  let raiseMs = null;
  const hPhases = [];
  for (let i = 0; i < 66; i++) {
    await sleep(24);
    const a = P.getAttack();
    hPhases.push(a.phase);
    if (a.armX) {
      peakX = Math.max(peakX, a.armX.leftX);
      peakZ = Math.max(peakZ, Math.abs(a.armX.leftZ));
      if (raiseMs === null && Math.abs(a.armX.leftZ) > 1.55) raiseMs = performance.now() - heavyStart;
      if (at900 === null && performance.now() - heavyStart >= 880) at900 = a.armX;
    }
  }
  out.heavy = {
    started: heavyStarted,
    peakX,
    peakZ,
    raiseMs: raiseMs === null ? null : Math.round(raiseMs),
    armAt900: at900,
    totalMs: Math.round(performance.now() - heavyStart),
    phases: [...new Set(hPhases)],
    canActAfter: P.getAttack().canAct,
  };

  // ---------- 4. 命中规则：轻击 3 次击倒 ----------
  const before = P.getCombat();
  for (let i = 0; i < 3; i++) {
    P.attack('light');
    await sleep(470);
  }
  const afterLights = P.getCombat();
  out.rulesLight = {
    before,
    after: afterLights,
    knockdowns: afterLights.knockdowns - before.knockdowns,
    lightHitsAfter: afterLights.lightHits,
    stunLeft: afterLights.stunLeft,
  };

  await sleep(400);
  // ---------- 重击一次即击倒 ----------
  const beforeHeavy = P.getCombat();
  P.attack('heavy');
  await sleep(1120);
  const afterHeavy = P.getCombat();
  out.rulesHeavy = {
    knockdowns: afterHeavy.knockdowns - beforeHeavy.knockdowns,
    stunLeft: afterHeavy.stunLeft,
    down: afterHeavy.down,
  };
  await sleep(700);

  // ---------- 5. 连击窗口：间隔 1.8 s 打 3 下不应击倒 ----------
  const beforeSlow = P.getCombat();
  for (let i = 0; i < 3; i++) {
    P.attack('light');
    await sleep(500);
    await sleep(1500);          // 已超过 1.6 s 连击窗口
  }
  const afterSlow = P.getCombat();
  out.comboWindow = {
    knockdowns: afterSlow.knockdowns - beforeSlow.knockdowns,
    lightHits: afterSlow.lightHits,
  };

  // ---------- 6. 出招不锁移动 ----------
  P.teleport(0, 0.05, 2);       // 起跑平台到 -22 扫地杆之间是干净路段
  await sleep(250);
  const z0 = P.getPlayer().z;
  P.stepInput(0, 1, false, true);
  await sleep(220);
  P.attack('heavy');            // 读条期间保持前进
  await sleep(900);
  P.releaseInput();
  const z1 = P.getPlayer().z;
  out.moveWhileHeavy = { z0, z1, moved: Math.round((z0 - z1) * 100) / 100 };

  // ---------- 7. 答题 Paused 期间不能出招 ----------
  P.teleportToGate(0);
  await sleep(200);
  P.startQuiz(0);
  await sleep(250);
  const pausedAttack = P.attack('light');
  const stateWhenPaused = P.getRace().state;
  P.answerCorrect();
  await sleep(250);
  out.quizLock = { stateWhileAsking: stateWhenPaused, attackAllowed: pausedAttack, stateAfter: P.getRace().state };

  return out;
})()
"""

SHOT_LIGHT = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  P.teleport(0, 0.05, -10);
  P.setOrbit(150, 7);
  await sleep(400);
  for (let i = 0; i < 40 && !P.getAttack().canAct; i++) await sleep(60);
  P.attack('light');
  await sleep(170);
  return P.getAttack();
})()
"""

SHOT_HEAVY_RAISE = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  P.teleport(0, 0.05, -10);
  P.setOrbit(150, 7);
  await sleep(400);
  for (let i = 0; i < 40 && !P.getAttack().canAct; i++) await sleep(60);
  P.attack('heavy');
  await sleep(900);
  return P.getAttack();
})()
"""

SHOT_HEAVY_SLAM = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 等上一招收完再起手，否则 attack() 会被状态机拒绝
  for (let i = 0; i < 40 && !P.getAttack().canAct; i++) await sleep(60);
  P.attack('heavy');
  await sleep(985);
  return P.getAttack();
})()
"""

SHOT_HEAVY_BACK = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  P.teleport(0, 0.05, -10);
  P.setOrbit(0, 9);                 // 默认第三人称背后视角
  await sleep(400);
  for (let i = 0; i < 40 && !P.getAttack().canAct; i++) await sleep(60);
  P.attack('heavy');
  await sleep(900);
  return P.getAttack();
})()
"""

SHOT_LIGHT_BACK = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && !P.getAttack().canAct; i++) await sleep(60);
  P.attack('light');
  await sleep(175);
  return P.getAttack();
})()
"""


async def shoot(cdp: Cdp, js: str, png: Path, wait_s: float = 0.3) -> None:
    await cdp.eval_js(js, timeout_s=20)
    await asyncio.sleep(wait_s)
    res = await cdp.call("Page.captureScreenshot", {"format": "png"})
    png.write_bytes(base64.b64decode(res["data"]))


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_verify5_")
    proc = subprocess.Popen(
        [
            find_chrome(),
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--autoplay-policy=no-user-gesture-required",
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

        async with connect(page["webSocketDebuggerUrl"], max_size=32 * 1024 * 1024) as ws:
            cdp = Cdp(ws)
            await cdp.call("Runtime.enable")
            await cdp.call("Page.enable")

            deadline = time.time() + 30
            while time.time() < deadline:
                ready = await cdp.eval_js("!!(window.__PPR && window.__PPR.attack)")
                if ready:
                    break
                await asyncio.sleep(0.5)
            else:
                raise SystemExit("页面未就绪（__PPR.attack 不存在，可能是 HMR 未生效）")

            await asyncio.sleep(0.8)
            result = await cdp.eval_js(MEASURE_JS, timeout_s=90)

            await shoot(cdp, SHOT_HEAVY_RAISE, OUT_DIR / "perf_m4_heavy_raise.png", 0.05)
            await shoot(cdp, SHOT_HEAVY_SLAM, OUT_DIR / "perf_m4_heavy_slam.png", 0.05)
            await shoot(cdp, SHOT_LIGHT, OUT_DIR / "perf_m4_light.png", 0.05)
            await shoot(cdp, SHOT_HEAVY_BACK, OUT_DIR / "perf_m4_heavy_back.png", 0.05)
            await shoot(cdp, SHOT_LIGHT_BACK, OUT_DIR / "perf_m4_light_back.png", 0.05)
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
