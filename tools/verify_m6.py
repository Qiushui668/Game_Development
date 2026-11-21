"""M4.1 验收：护栏圆角顶 + 答题被打倒则中断。

覆盖：
  1. 护栏顶站不住：站到护栏上沿前进，会滑落/掉出赛道，无法沿护栏顶跑到答题墙
  2. 答题中被重击击倒：答题立刻作废（phase=off、墙未拆）、退回 Racing、角色眩晕 1 s
  3. 轻击累计 3 次才击倒；前两次只累计不打断
  4. 未答题时被打中：只眩晕，不产生"答题中断"
  5. 被打断后可以重新按 F 开答（换一道新题）
  6. 眩晕结束能正常跑动

用法：.venv\\Scripts\\python.exe tools/verify_m6.py [url]
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
  const TRACK_BAND = 9.06;      // TRACK.width/2 + 0.06，护栏带内
  const out = {};
  P.releaseInput();
  if (P.startNow) P.startNow();
  await sleep(250);

  // ---------- 1. 护栏圆角顶：站不住 ----------
  P.teleport(9.25, 1.32, -74);
  await sleep(350);
  const onRail = P.getPlayer();
  P.stepInput(0, 1, false, false);
  let perched = 0;
  let perchMinZ = 0;
  let minY = onRail.y;
  for (let i = 0; i < 26; i++) {
    await sleep(45);
    const s = P.getPlayer();
    minY = Math.min(minY, s.y);
    // 还站在护栏顶（脚底 > 0.9 且人在护栏带内）的采样
    if (s.y > 0.9 && Math.abs(s.x) > TRACK_BAND) {
      perched++;
      perchMinZ = Math.min(perchMinZ, s.z);
    }
  }
  P.releaseInput();
  await sleep(500);
  const railEnd = P.getPlayer();
  out.railTop = {
    startY: onRail.y,
    endY: railEnd.y,
    endX: railEnd.x,
    endZ: railEnd.z,
    minY,
    perchedSamples: perched,
    // 沿护栏顶最远推进的 z（perchMinZ 越接近 -74 说明没往墙那边走）
    perchMinZ,
    slidBackIntoTrack: railEnd.y < 0.3 && Math.abs(railEnd.x) < 9.0,
  };

  // 复位到赛道内
  P.teleport(0, 0.05, -74);
  await sleep(300);

  // ---------- 2. 答题中被重击击倒 → 中断 ----------
  P.teleport(0, 0.05, -78 + 2.2);
  await sleep(200);
  P.startQuiz(0);
  await sleep(250);
  const beforeHit = {
    phase: P.getQuiz().phase,
    race: P.getRace().state,
    wall: P.getQuizWalls()[0],
    music: P.getMusic(),
  };
  const heavy = P.hitPlayer('heavy');
  await sleep(60);
  const afterHeavy = {
    phase: P.getQuiz().phase,
    race: P.getRace().state,
    wall: P.getQuizWalls()[0],
    music: P.getMusic(),
    interrupted: P.getQuiz().interrupted,
    self: P.getSelfHits(),
    stunned: P.getPlayer().stunned,
  };
  out.heavyInterrupt = { before: beforeHit, hit: heavy, after: afterHeavy };

  // 眩晕期间推不动
  P.stepInput(0, 1, false, true);
  await sleep(300);
  P.releaseInput();
  const duringStun = P.getPlayer();
  await sleep(900);
  const afterStun = P.getPlayer();
  P.stepInput(0, 1, false, true);
  await sleep(500);
  P.releaseInput();
  const recovered = P.getPlayer();
  out.stun = {
    stunnedDuring: duringStun.stunned,
    speedDuring: duringStun.speed,
    recoveredSpeed: recovered.speed,
    stunCleared: !afterStun.stunned,
  };

  // ---------- 3. 轻击 3 次才打断 ----------
  P.teleport(0, 0.05, -78 + 2.2);
  P.resetHealth();              // 上一段吃了重击，先回满血再测"3 次轻击才倒"
  await sleep(700);
  P.startQuiz(0);
  await sleep(250);
  const l1 = P.hitPlayer('light');
  await sleep(200);
  const afterL1 = { phase: P.getQuiz().phase, lightHits: P.getSelfHits().lightHits };
  const l2 = P.hitPlayer('light');
  await sleep(200);
  const afterL2 = { phase: P.getQuiz().phase, lightHits: P.getSelfHits().lightHits };
  const l3 = P.hitPlayer('light');
  await sleep(120);
  const afterL3 = {
    phase: P.getQuiz().phase,
    race: P.getRace().state,
    interrupted: P.getQuiz().interrupted,
    self: P.getSelfHits(),
  };
  out.lightInterrupt = { l1, afterL1, l2, afterL2, l3, afterL3 };

  // ---------- 4. 没在答题时被打中 ----------
  await sleep(1200);
  const notAsking = P.getQuiz().phase;
  const quiet = P.hitPlayer('heavy');
  out.notAsking = { phaseWhenHit: notAsking, result: quiet, interruptedFlag: P.getQuiz().interrupted };

  // ---------- 5. 打断后能重新答题（换新题） ----------
  await sleep(1400);
  P.teleport(0, 0.05, -78 + 2.2);
  await sleep(300);
  if (P.getRace().state !== 'Racing') P.startNow();
  const reopened = P.startQuiz(0);
  await sleep(220);
  const q2 = P.getQuiz();
  out.reopen = {
    ok: reopened,
    phase: q2.phase,
    gate: q2.gate,
    textLen: q2.text.length,
    options: q2.options.length,
    wallOpen: P.getQuizWalls()[0].opened,
  };
  P.answerCorrect();
  await sleep(250);

  // 收尾：清掉提示、复位角色
  P.teleport(0, 0.05, 2);
  await sleep(200);
  out.finalState = { race: P.getRace().state, solved: P.getQuiz().solved };
  return out;
})()
"""

SHOT_RAIL = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  P.teleport(6.4, 0.05, -30);
  P.setOrbit(-118, 22);          // 从赛道内斜看护栏顶
  await sleep(700);
  return P.getPlayer();
})()
"""

SHOT_INTERRUPT = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  P.teleport(0, 0.05, -78 + 2.2);
  await sleep(250);
  P.startQuiz(0);
  await sleep(200);
  P.hitPlayer('heavy');
  await sleep(240);
  return P.getQuiz();
})()
"""


async def shoot(cdp: Cdp, js: str, png: Path, wait_s: float = 0.05) -> None:
    await cdp.eval_js(js, timeout_s=25)
    await asyncio.sleep(wait_s)
    res = await cdp.call("Page.captureScreenshot", {"format": "png"})
    png.write_bytes(base64.b64decode(res["data"]))


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_verify6_")
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
                # B 阶段起首页先展示：自动化从"单人游戏"点进去
                await cdp.eval_js(
                    "(() => { const gi = document.querySelector('.gate-input'); if (gi && !gi.value) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(gi, '验收员'); gi.dispatchEvent(new Event('input', { bubbles: true })); } const go = document.querySelector('.gate-go'); if (go && !go.disabled) go.click(); const b = document.querySelector('.mode.solo'); if (b) b.click(); return !!b; })()"
                )
                ready = await cdp.eval_js("!!(window.__PPR && window.__PPR.hitPlayer)")
                if ready:
                    break
                await asyncio.sleep(0.5)
            else:
                raise SystemExit("页面未就绪（__PPR.hitPlayer 不存在，可能 HMR 没吃到新代码）")

            await asyncio.sleep(0.8)
            result = await cdp.eval_js(MEASURE_JS, timeout_s=60)

            await shoot(cdp, SHOT_RAIL, OUT_DIR / "perf_m4_rail_round.png", 0.2)
            await shoot(cdp, SHOT_INTERRUPT, OUT_DIR / "perf_m4_quiz_interrupt.png", 0.15)
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
