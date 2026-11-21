"""M3.3 背景音乐 + 答题关卡自动化验收。

覆盖：
  1. 背景音乐：开始播放 / loop / 时长 / duck
  2. 四面答题墙：位置正确、逐面挡人、墙前出现按 F 提示
  3. 按 F 开答：进入 Paused、输入冻结、指针锁释放
  4. 答错：冻结 3 s、倒计时递减、结束后换新题
  5. 冻结期间世界也停（障碍角度不变）、比赛计时继续累加
  6. 答对：拆墙、恢复 Racing、人可以跑过去
  7. 冲线仍可用；重开一局墙与答题进度全部复位

用法：.venv\\Scripts\\python.exe tools\\verify_m4.py [url]
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

  // ---------- 1. 背景音乐 ----------
  P.startMusic();
  await sleep(900);
  out.music = P.getMusic();

  // ---------- 2. 四面墙都在，逐面挡人 + 墙前提示 ----------
  const wallsAtStart = P.getQuizWalls();
  out.wallCount = wallsAtStart.length;
  out.wallZ = wallsAtStart.map((w) => w.z);
  out.gates = [];
  for (let i = 0; i < wallsAtStart.length; i++) {
    const wz = wallsAtStart[i].z;
    P.teleport(0, 0.05, wz + 3);
    await sleep(180);
    const prompt = P.getQuiz().promptGate;
    P.stepInput(0, 1, false, true);
    await sleep(1200);
    P.releaseInput();
    const z = P.getPlayer().z;
    out.gates.push({ gate: i + 1, prompt, stopZ: z, blocked: z > wz, gap: z - wz });
    await sleep(120);
  }

  // ---------- 2.5 从两侧绕：站在护栏顶 / 斜向跳，都不能过墙 ----------
  P.releaseInput();
  P.teleport(9.25, 1.15, -74);
  await sleep(350);
  const onRail = P.getPlayer();
  P.stepInput(0, 1, false, false);
  await sleep(1300);
  P.releaseInput();
  const railEnd = P.getPlayer();
  out.railBypass = {
    startY: onRail.y,
    endZ: railEnd.z,
    endX: railEnd.x,
    blocked: railEnd.z > -78,
  };

  P.teleport(7.6, 0.05, -74);
  await sleep(200);
  P.stepInput(1, 1, true);
  await sleep(900);
  P.releaseInput();
  const sideJump = P.getPlayer();
  out.sideJump = { z: sideJump.z, x: sideJump.x, blocked: sideJump.z > -78 };

  // 站在护栏顶、连续斜跳试图从墙外绕过去：只统计"还在赛道走廊内（|x| ≤ 10.2）"的采样，
  // 跳到护栏外悬空属于掉进虚空复活，不算绕过
  P.teleport(9.0, 1.02, -74);
  await sleep(300);
  let minInsideZ = 0;
  let maxX = 0;
  P.stepInput(1, 0.55, false, true);
  for (let i = 0; i < 6; i++) {
    P.stepInput(1, 0.55, true, true);
    for (let k = 0; k < 6; k++) {
      await sleep(45);
      const s = P.getPlayer();
      maxX = Math.max(maxX, Math.abs(s.x));
      if (Math.abs(s.x) <= 10.2) minInsideZ = Math.min(minInsideZ, s.z);
    }
  }
  P.releaseInput();
  const afterJumps = P.getPlayer();
  out.railJumpBypass = {
    minInsideZ,
    maxX,
    endZ: afterJumps.z,
    endX: afterJumps.x,
    blocked: minInsideZ > -78 && afterJumps.z > -78,
  };

  // ---------- 3. 按 F 开答 ----------
  P.teleport(0, 0.05, -78 + 2.2);
  await sleep(180);
  P.stepInput(0, 1, false, true);
  await sleep(900);
  P.releaseInput();
  await sleep(120);
  const standZ = P.getPlayer().z;
  P.startQuiz(0);
  await sleep(130);
  const asking = P.getQuiz();
  const raceAtStart = P.getRace();
  out.asking = {
    phase: asking.phase,
    gate: asking.gate,
    options: asking.options.length,
    textLen: asking.text.length,
    category: asking.category,
    raceState: raceAtStart.state,
    pointerLocked: !!document.pointerLockElement,
  };

  // 答题期间输入被锁死：再推一次前进，位置应完全不动
  P.stepInput(0, 1, false, true);
  await sleep(550);
  P.releaseInput();
  const frozenPlayer = P.getPlayer();
  out.inputLocked = { dz: Math.abs(frozenPlayer.z - standZ), standZ };

  // ---------- 4. 答错 → 3 s 冻结 → 换题 ----------
  const qBefore = P.getQuiz();
  P.answerWrong();
  await sleep(150);
  const wrong = P.getQuiz();
  const elapsedAtFreeze = P.getRace().elapsedMs;
  const obA = P.getObstacles();
  await sleep(650);
  const obB = P.getObstacles();
  out.freeze = {
    phase: wrong.phase,
    freezeLeft: wrong.freezeLeft,
    wrongCount: wrong.wrongCount,
    obstacleDelta: Math.abs(obB.sweeperAngles[0] - obA.sweeperAngles[0]),
  };
  await sleep(2550);
  const afterFreeze = P.getQuiz();
  const elapsedAfterFreeze = P.getRace().elapsedMs;
  out.reissue = {
    phase: afterFreeze.phase,
    questionChanged: afterFreeze.text !== qBefore.text,
    wrongCount: afterFreeze.wrongCount,
    timerDeltaMs: elapsedAfterFreeze - elapsedAtFreeze,
  };

  // ---------- 5. 答对 → 拆墙 → 恢复比赛 ----------
  P.answerCorrect();
  await sleep(150);
  const correct = P.getQuiz();
  out.correctMoment = {
    phase: correct.phase,
    solved: correct.solved,
    opened: P.getQuizWalls().map((w) => w.opened),
  };
  await sleep(900);
  const settled = P.getQuiz();
  out.correct = {
    phase: settled.phase,
    solved: settled.solved,
    raceState: P.getRace().state,
    music: P.getMusic(),
  };

  // ---------- 6. 墙开了真的能过去 ----------
  P.teleport(0, 0.05, -72);
  await sleep(200);
  P.stepInput(0, 1, false, true);
  await sleep(1500);
  P.releaseInput();
  const passed = P.getPlayer();
  out.pass = { z: passed.z, passedWall: passed.z < -78.5 };

  // ---------- 7. 冲线仍然可用 + 重开复位 ----------
  P.openAllGates();
  P.teleport(0, 0.1, -316);
  await sleep(250);
  P.stepInput(0, 1, false, true);
  const t0 = performance.now();
  while (performance.now() - t0 < 5000) {
    if (P.getRace().state === 'Result') break;
    await sleep(16);
  }
  P.releaseInput();
  out.finish = P.getRace();

  P.restartRace();
  await sleep(250);
  out.restart = {
    race: P.getRace(),
    solved: P.getQuiz().solved,
    walls: P.getQuizWalls().map((w) => w.opened),
  };

  return out;
})()
"""

# 截图脚本：每段单独 eval，避免互相干扰
SHOT_WALL = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (P.startNow) P.startNow();
  P.teleport(0, 0.05, -72.5);
  await sleep(900);
  return P.getQuiz().promptGate;
})()
"""

SHOT_WALL2 = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (P.startNow) P.startNow();
  P.teleport(0, 0.05, -192);
  await sleep(900);
  return P.getQuiz().promptGate;
})()
"""

SHOT_ASKING = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (P.startNow) P.startNow();
  P.teleport(0, 0.05, -76.2);
  await sleep(400);
  P.startQuiz(0);
  await sleep(600);
  return P.getQuiz().phase;
})()
"""

SHOT_FREEZE = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.answerWrong();
  await sleep(340);
  return P.getQuiz();
})()
"""


async def shoot(cdp: Cdp, js: str, png: Path, wait_s: float = 0.5) -> None:
    await cdp.eval_js(js, timeout_s=20)
    await asyncio.sleep(wait_s)
    res = await cdp.call("Page.captureScreenshot", {"format": "png"})
    png.write_bytes(base64.b64decode(res["data"]))


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_verify4_")
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
                ready = await cdp.eval_js("!!(window.__PPR && window.__PPR.getQuiz)")
                if ready:
                    break
                await asyncio.sleep(0.5)
            else:
                raise SystemExit("页面未就绪")

            await asyncio.sleep(0.8)
            result = await cdp.eval_js(MEASURE_JS, timeout_s=70)

            await shoot(cdp, SHOT_WALL, OUT_DIR / "perf_m3_3_wall.png", 0.9)
            await shoot(cdp, SHOT_WALL2, OUT_DIR / "perf_m3_3_wall3.png", 0.9)
            await shoot(cdp, SHOT_ASKING, OUT_DIR / "perf_m3_3_quiz.png", 0.6)
            await shoot(cdp, SHOT_FREEZE, OUT_DIR / "perf_m3_3_freeze.png", 0.4)
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
