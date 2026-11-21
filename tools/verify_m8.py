"""本轮（血条 / 新障碍 / 击杀）单机验收。

覆盖用户 5 条需求的单机可验证部分：
  1. 进站先输昵称（未确认前不显示单人/多人），确认后模式按钮出现，昵称写进本地记忆
  2. 人物头顶挂着昵称名牌
  3. 初始血量 100，HUD 有血条与击杀数
  4. 柱子转速加快（角速度 ≈ 1.35×1.6 rad/s）
  5. 新增地刺（4 条，会周期顶起）与大摆锤（2 根，会摆动）
  6. 被障碍命中统一 −10（真实走进地刺验证）
  7. 左键轻击 −34、右键重击 −70
  8. 血量归零回起点并回满 100
  9. 1杀.mp3 已随包提供，音效链路可播

用法：.venv\\Scripts\\python.exe tools/verify_m8.py [url]
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

from perf_probe import Cdp, ENTER_SOLO_JS, find_chrome, free_port, list_targets  # noqa: E402

OUT_DIR = Path(__file__).parent

GATE_JS = r"""
(() => ({
  gate: !!document.querySelector('.gate'),
  modes: document.querySelectorAll('.mode').length,
  names: [...document.querySelectorAll('.mode .name')].map((e) => e.textContent.trim()),
}))()
"""

MEASURE_JS = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  await sleep(300);

  // ---------- 初始状态 ----------
  out.initial = { status: P.getStatus(), tag: P.getNameTag(), race: P.getRace().state };

  // ---------- 柱子转速 ----------
  const a0 = P.getObstacles().sweeperAngles[0];
  await sleep(1000);
  const a1 = P.getObstacles().sweeperAngles[0];
  let delta = Math.abs(a1 - a0);
  if (delta > Math.PI) delta = Math.abs(delta - Math.PI * 2);
  out.sweeperSpeed = { a0, a1, delta, expected: 1.35 * 1.6 };

  // ---------- 新障碍存在且在动 ----------
  const o1 = P.getObstacles();
  await sleep(700);
  const o2 = P.getObstacles();
  out.obstacles = {
    spikeCount: o1.spikeRise.length,
    pendulumCount: o1.pendulumAngles.length,
    spikeRise1: o1.spikeRise,
    spikeRise2: o2.spikeRise,
    spikeMax: Math.max(...o1.spikeRise, ...o2.spikeRise),
    pendulum1: o1.pendulumAngles,
    pendulum2: o2.pendulumAngles,
    pendulumMaxAbs: Math.max(...o1.pendulumAngles.map(Math.abs), ...o2.pendulumAngles.map(Math.abs)),
  };

  // ---------- 真实走进地刺：−10 ----------
  // 地刺在 z=-40：站到刺阵正中，等它顶起来打一下
  P.teleport(0, 0.05, -40);
  const hpTrace = [P.getStatus().hp];
  let hits = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 6000) {
    await sleep(40);
    const hp = P.getStatus().hp;
    if (hp !== hpTrace[hpTrace.length - 1]) {
      hpTrace.push(hp);
      hits++;
      if (hits >= 3) break;
    }
  }
  out.spikeHit = {
    hpTrace,
    hits,
    log: P.getDamageLog().map((d) => ({ amount: d.amount, cause: d.cause })),
  };
  P.teleport(0, 0.05, 2);
  await sleep(300);

  // ---------- 重击 -70 / 轻击 -34 ----------
  P.resetHealth();                                  // 障碍扣过血，先回满再测攻击伤害
  await sleep(200);
  const hpStart = P.getStatus().hp;
  const heavy = P.hitPlayer('heavy');
  await sleep(150);
  const hpHeavy = P.getStatus().hp;                 // 100 - 70 = 30
  const light = P.hitPlayer('light');               // 30 - 34 < 0 → 死
  await sleep(200);
  const hpLight = P.getStatus().hp;                 // 已复活 → 100
  out.damage = {
    hpStart, heavy, hpHeavy, light, hpLight,
    log: P.getDamageLog().map((d) => ({ amount: d.amount, cause: d.cause, dead: d.dead })),
    status: P.getStatus(),
  };
  out.deathByLight = { status: P.getStatus(), pos: P.getPlayer() };

  // ---------- 自杀流程：归零回起点满血 ----------
  await sleep(600);
  P.teleport(0, 0.05, -120);
  await sleep(300);
  const deathsBefore = P.getStatus().deaths;
  const killed = P.killSelf();
  await sleep(400);
  out.killSelf = {
    returned: killed,
    status: P.getStatus(),
    deathsBefore,
    pos: P.getPlayer(),
    flash: P.getStatus().deathFlash,
  };

  // ---------- 音效链路 ----------
  let audioOk = false;
  try {
    const r = await fetch('/audio/kill.mp3', { method: 'HEAD' });
    audioOk = r.ok;
  } catch (e) {
    audioOk = false;
  }
  out.sfx = { snapshot: P.getSfx(), audioOk };

  // ---------- HUD ----------
  out.hud = (() => {
    const v = document.querySelector('.vitals');
    const c = document.querySelector('.controls');
    return {
      vitals: v ? v.textContent.replace(/\s+/g, ' ').trim() : null,
      controls: c ? c.textContent.replace(/\s+/g, ' ').trim() : null,
    };
  })();

  return out;
})()
"""

SHOT_SPIKE = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  // 站在刺阵前 5 m，等到刺顶起来再拍
  P.teleport(0.0, 0.05, -34.5);
  let best = 0;
  for (let i = 0; i < 26; i++) {
    await sleep(90);
    const rise = P.getObstacles().spikeRise[0];
    if (rise > best) best = rise;
    if (rise > 0.85) break;
  }
  P.setCamera([7.5, 3.2, -33.5], [0, 0.7, -40]);
  await sleep(250);
  return { rise: best };
})()
"""

SHOT_PENDULUM = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  P.teleport(0.0, 0.05, -152);
  // 摆到正中偏右时取景，能同时看清门架、锤臂与锤头
  for (let i = 0; i < 30; i++) {
    await sleep(80);
    const a = P.getObstacles().pendulumAngles[0];
    if (Math.abs(a) > 0.25) break;
  }
  P.setCamera([6.5, 3.4, -151], [0, 2.2, -160]);
  await sleep(200);
  return P.getObstacles().pendulumAngles;
})()
"""

SHOT_HUD = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  // 停在刺阵前，让血条、名牌、地刺同框；再吃两记轻击到 32 血
  P.teleport(0.0, 0.05, -34.5);
  for (let i = 0; i < 26; i++) {
    await sleep(90);
    if (P.getObstacles().spikeRise[0] > 0.85) break;
  }
  P.hitPlayer('light');
  P.hitPlayer('light');
  await sleep(200);
  return P.getStatus();
})()
"""


async def shoot(cdp: Cdp, js: str, png: Path, wait_s: float = 0.1) -> None:
    await cdp.eval_js(js, timeout_s=30)
    await asyncio.sleep(wait_s)
    res = await cdp.call("Page.captureScreenshot", {"format": "png"})
    png.write_bytes(base64.b64decode(res["data"]))


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_verify8_")
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

    results: list[dict] = []
    failures = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failures
        results.append({"name": name, "ok": bool(ok), "detail": detail})
        if not ok:
            failures += 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}".rstrip(), flush=True)

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

            # ---------- 1. 昵称门 ----------
            deadline = time.time() + 20
            gate = None
            while time.time() < deadline:
                gate = await cdp.eval_js(GATE_JS)
                if gate and gate.get("gate"):
                    break
                await asyncio.sleep(0.3)
            check(
                "进站先要昵称，未确认前没有单人/多人按钮",
                bool(gate) and gate["gate"] is True and gate["modes"] == 0,
                json.dumps(gate, ensure_ascii=False),
            )
            gate_shot = await cdp.call("Page.captureScreenshot", {"format": "png"})
            (OUT_DIR / "perf_m8_home_gate.png").write_bytes(base64.b64decode(gate_shot["data"]))

            await cdp.eval_js(
                "(() => { const el = document.querySelector('.gate-input');"
                " const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;"
                " set.call(el, '验收员'); el.dispatchEvent(new Event('input', { bubbles: true }));"
                " return el.value; })()"
            )
            await cdp.eval_js("(() => { const b = document.querySelector('.gate-go'); if (b) b.click(); return true; })()")
            await asyncio.sleep(0.5)

            gate2 = await cdp.eval_js(GATE_JS)
            check(
                "确认昵称后才出现单人 / 多人",
                gate2["modes"] == 2 and gate2["names"] == ["单人游戏", "多人游戏"],
                json.dumps(gate2, ensure_ascii=False),
            )
            home = await cdp.call("Page.captureScreenshot", {"format": "png"})
            (OUT_DIR / "perf_m8_home_named.png").write_bytes(base64.b64decode(home["data"]))

            # ---------- 进单人局 ----------
            deadline = time.time() + 30
            while time.time() < deadline:
                await cdp.eval_js(ENTER_SOLO_JS)
                ready = await cdp.eval_js("!!(window.__PPR && window.__PPR.getStatus)")
                if ready:
                    break
                await asyncio.sleep(0.5)
            else:
                raise SystemExit("页面未就绪（__PPR.getStatus 不存在）")

            await asyncio.sleep(1.0)
            got = await cdp.eval_js(MEASURE_JS, timeout_s=90)
            init = got["initial"]
            check(
                "初始满血 100、头顶有昵称名牌",
                init["status"]["hp"] == 100
                and init["status"]["maxHp"] == 100
                and init["tag"]
                and init["tag"]["text"] == "验收员"
                and init["tag"]["visible"],
                json.dumps(init, ensure_ascii=False),
            )
            check(
                "人物头顶名牌挂在角色上（离地 2.3 m）",
                init["tag"]["parent"] is True and abs(init["tag"]["y"] - 2.3) < 0.01,
                json.dumps(init["tag"], ensure_ascii=False),
            )

            sp = got["sweeperSpeed"]
            check(
                "柱子转速加快（实测 ≈2.16 rad/s）",
                1.9 <= sp["delta"] <= 2.35,
                f"Δ={sp['delta']:.2f} rad/s（基准 1.35 → ×1.6 = 2.16）",
            )

            ob = got["obstacles"]
            check(
                "新增地刺 4 条且会周期顶起",
                ob["spikeCount"] == 4
                and ob["spikeMax"] > 0.9
                and ob["spikeRise1"] != ob["spikeRise2"],
                f"count={ob['spikeCount']} max={ob['spikeMax']:.2f}",
            )
            check(
                "新增大摆锤 2 根且会摆动（摆角 ≈±0.8 rad）",
                ob["pendulumCount"] == 2
                and ob["pendulumMaxAbs"] > 0.4
                and ob["pendulum1"] != ob["pendulum2"],
                f"maxAbs={ob['pendulumMaxAbs']:.2f}",
            )

            sh = got["spikeHit"]
            obstacle_amounts = [e["amount"] for e in sh["log"] if e["cause"] == "obstacle"]
            check(
                "走进地刺被命中 −10（伤害流水里障碍扣血恒为 10）",
                len(sh["hpTrace"]) >= 2
                and sh["hpTrace"][1] == 90
                and obstacle_amounts
                and all(a == 10 for a in obstacle_amounts),
                f"hpTrace={sh['hpTrace']} amounts={obstacle_amounts}",
            )

            dmg = got["damage"]
            check("右鍵重击 -70（100 → 30）", dmg["hpHeavy"] == dmg["hpStart"] - 70, f"{dmg['hpStart']} → {dmg['hpHeavy']}")
            heavy_amounts = [e["amount"] for e in dmg["log"] if e["cause"] == "heavy"]
            light_amounts = [e["amount"] for e in dmg["log"] if e["cause"] == "light"]
            check(
                "左键轻击 -34（30 → 0 直接打死）",
                heavy_amounts[:1] == [70]
                and light_amounts[:1] == [34]
                and dmg["hpLight"] == 100
                and dmg["status"]["deaths"] >= 1,
                f"heavy={heavy_amounts} light={light_amounts} hp={dmg['hpLight']} deaths={dmg['status']['deaths']}",
            )

            tb = got["deathByLight"]
            check(
                "血量归零回起点并回满 100",
                tb["status"]["hp"] == 100 and abs(tb["pos"]["z"] - 3.5) < 0.8,
                f"hp={tb['status']['hp']} z={tb['pos']['z']:.2f}",
            )

            ks = got["killSelf"]
            check(
                "自杀式清空血量同样回起点（deaths 递增）",
                ks["status"]["hp"] == 100
                and ks["status"]["deaths"] == ks["deathsBefore"] + 1
                and abs(ks["pos"]["z"] - 3.5) < 0.8,
                f"hp={ks['status']['hp']} deaths={ks['status']['deaths']} z={ks['pos']['z']:.2f}",
            )

            sfx = got["sfx"]
            check(
                "1杀.mp3 随包提供（/audio/kill.mp3 可访问）",
                sfx["audioOk"] is True and sfx["snapshot"]["src"].endswith("kill.mp3"),
                json.dumps(sfx, ensure_ascii=False),
            )

            hud = got["hud"]
            check(
                "HUD 血条 + 击杀数 + 伤害提示",
                hud["vitals"] is not None
                and "HP" in hud["vitals"]
                and "击杀" in hud["vitals"]
                and "-34" in (hud["controls"] or "")
                and "-70" in (hud["controls"] or ""),
                json.dumps(hud, ensure_ascii=False),
            )

            # ---------- 截图取证 ----------
            await shoot(cdp, SHOT_SPIKE, OUT_DIR / "perf_m8_spikes.png", 0.15)
            await shoot(cdp, SHOT_PENDULUM, OUT_DIR / "perf_m8_pendulum.png", 0.15)
            await shoot(cdp, SHOT_HUD, OUT_DIR / "perf_m8_hud.png", 0.15)

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    report = {
        "url": url,
        "collectedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "pass": failures == 0,
        "results": results,
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    (OUT_DIR / "verify_m8.json").write_text(text, encoding="utf-8")
    print(text)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
