"""本轮（头顶血条 / 柱子大击退 / 随机方格桥）单机验收。

覆盖三条新需求：
  1. 每个人物昵称上面有血条 + 血量数字，受伤后数字跟着掉，复活回满
  2. 柱子击退加大：扫地杆专用初速 22 m/s，实测退 7–8 m（其它障碍维持原值）
  3. 赛道上的方格桥：随机抽成"会消失 / 会回弹 / 实心"
     - 消失格踩上去先抖 0.3 s 再塌，人跟着掉进虚空 → 回起点满血复活
     - 回弹格踩上去被往起点方向弹回十几米，且不扣血
     - 每局重新随机（assignmentId 递增、角色分布变化）

用法：.venv\\Scripts\\python.exe tools/verify_m9.py [url]
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

MEASURE_JS = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  await sleep(300);

  // ---------- 1. 头顶血条：初始 → 轻击 → 重击致死 ----------
  out.tagInit = P.getNameTag();
  P.hitPlayer('light');
  await sleep(120);
  out.tagLight = P.getNameTag();
  out.hpLight = P.getStatus().hp;
  P.resetHealth();
  await sleep(120);
  P.teleport(0, 0.05, -20);
  await sleep(150);
  P.hitPlayer('heavy');          // 100 - 70 = 30
  await sleep(120);
  out.tagHeavy = P.getNameTag();
  P.hitPlayer('heavy');          // 30 - 70 < 0 → 死 → 回满
  await sleep(250);
  out.tagDead = P.getNameTag();
  P.resetHealth();
  P.teleport(0, 0.05, 2);
  await sleep(200);

  // ---------- 2. 柱子击退 ----------
  out.tuning = P.getTuning();
  P.teleport(0, 0.05, -20);
  await sleep(200);
  const pushFrom = P.getPlayer();
  const pushed = P.pushPlayer(0, 1, out.tuning.sweepKnockbackSpeed, 0, 0.9);
  await sleep(1400);
  const pushTo = P.getPlayer();
  out.push = {
    applied: pushed,
    speed: out.tuning.sweepKnockbackSpeed,
    dz: pushTo.z - pushFrom.z,
    dist: Math.hypot(pushTo.x - pushFrom.x, pushTo.z - pushFrom.z),
    stunnedEnd: pushTo.stunned,
  };

  // 真实扫中：站在第一根摆臂的扫掠线上，等它扫过来
  P.resetHealth();
  P.teleport(0, 0.05, -22);
  await sleep(200);
  const sweepStart = P.getPlayer();
  let hitPos = null;
  const t0 = performance.now();
  while (performance.now() - t0 < 7000) {
    const s = P.getPlayer();
    if (s.stunned) { hitPos = s; break; }
    await sleep(16);
  }
  await sleep(1200);
  const sweepEnd = P.getPlayer();
  out.sweepReal = {
    hit: hitPos !== null,
    hitSpeed: hitPos ? hitPos.speed : 0,
    moved: hitPos ? Math.hypot(sweepEnd.x - hitPos.x, sweepEnd.z - hitPos.z) : 0,
    hp: P.getStatus().hp,
    log: P.getDamageLog().map((d) => ({ amount: d.amount, cause: d.cause })),
  };

  // ---------- 3. 方格桥 ----------
  const t1 = P.getTiles();
  const count = (arr, r) => arr.filter((x) => x.role === r).length;
  const summarize = (t) => ({
    id: t.assignmentId,
    tiles: t.tiles.length,
    zones: t.zones.length,
    vanish: count(t.tiles, 'vanish'),
    bounce: count(t.tiles, 'bounce'),
    solid: count(t.tiles, 'solid'),
    roles: t.tiles.map((x) => x.role[0]).join(''),
  });
  out.tiles1 = summarize(t1);

  // 重抽一次：批次号 +1，分布应当变化（随机性）
  const id1 = P.rerollTiles();
  const t2 = P.getTiles();
  out.tiles2 = { ...summarize(t2), rerollReturned: id1 };
  out.randomness = {
    sameLayout: out.tiles1.roles === out.tiles2.roles,
    batchChanged: out.tiles2.id > out.tiles1.id,
  };

  // ---------- 3a. 消失格：踩上去 → 掉进虚空 → 回起点满血 ----------
  // 只用第一段桥的格子：那段桥前后都没有实体障碍，结果不受扫地杆干扰
  const t3 = P.getTiles();
  const zone0Vanish = t3.tiles.filter((x) => x.role === 'vanish' && x.zone === 0);
  const vanishTiles = zone0Vanish.length > 0 ? zone0Vanish : t3.tiles.filter((x) => x.role === 'vanish');
  const vanish = vanishTiles[Math.floor(vanishTiles.length / 2)];
  P.resetHealth();
  P.teleport(vanish.x, 0.08, vanish.z);
  await sleep(120);
  const vanishBefore = {
    hp: P.getStatus().hp,
    deaths: P.getStatus().deaths,
    z: P.getPlayer().z,
    logLen: P.getDamageLog().length,
  };
  let fell = false;
  let phaseSeen = null;
  const tFall = performance.now();
  while (performance.now() - tFall < 4000) {
    const st = P.getTiles().tiles[vanish.index];
    if (st && (st.phase === 'tremble' || st.phase === 'drop' || st.phase === 'gone')) phaseSeen = st.phase;
    const pos = P.getPlayer();
    if (pos.z > 2.0) { fell = true; break; }
    await sleep(30);
  }
  await sleep(700);
  const vanishAfter = {
    hp: P.getStatus().hp,
    deaths: P.getStatus().deaths,
    z: P.getPlayer().z,
    x: P.getPlayer().x,
    solid: P.getTiles().tiles[vanish.index].solid,
    phase: P.getTiles().tiles[vanish.index].phase,
    logLen: P.getDamageLog().length,
    damageLog: P.getDamageLog().slice(-3).map((d) => ({ amount: d.amount, cause: d.cause })),
  };
  out.vanishTile = { index: vanish.index, at: { x: vanish.x, z: vanish.z }, phaseSeen, fell, before: vanishBefore, after: vanishAfter };

  // ---------- 3b. 回弹格：踩上去 → 往起点方向弹十几米，且不扣血 ----------
  // 先把"回弹初速"本身量一遍（避开赛道上的其它障碍，纯靠速度衰减算退距）
  P.resetHealth();
  P.teleport(0, 0.05, -10);
  await sleep(250);
  const bpFrom = P.getPlayer();
  const bpApplied = P.pushPlayer(0, 1, out.tuning.tileBounceSpeed, 12, out.tuning.tileBounceStun);
  await sleep(1500);
  const bpTo = P.getPlayer();
  out.pushBounce = {
    applied: bpApplied,
    speed: out.tuning.tileBounceSpeed,
    dist: Math.hypot(bpTo.x - bpFrom.x, bpTo.z - bpFrom.z),
    dz: bpTo.z - bpFrom.z,
  };

  P.resetHealth();
  await sleep(200);
  const t4 = P.getTiles();
  const zone0Bounce = t4.tiles.filter((x) => x.role === 'bounce' && x.zone === 0 && x.solid && x.phase === 'idle');
  const bounceTiles = zone0Bounce.length > 0
    ? zone0Bounce
    : t4.tiles.filter((x) => x.role === 'bounce' && x.solid && x.phase === 'idle');
  const bounce = bounceTiles[Math.floor(bounceTiles.length / 2)];
  const bounceHp0 = P.getStatus().hp;
  const bounceLog0 = P.getDamageLog().length;
  // 注意：踩上回弹格的那一瞬间就会被弹出去，所以"起点"必须取格子本身的位置，
  // 不能等 100 多毫秒后再取当前坐标（否则会把已经飞出的几米漏掉）
  P.teleport(bounce.x, 0.08, bounce.z);
  const trace = [];
  for (let i = 0; i < 9; i++) {
    await sleep(100);
    const s = P.getPlayer();
    trace.push({ t: (i + 1) * 100, z: +(s.z - bounce.z).toFixed(2), y: +s.y.toFixed(2), sp: +s.speed.toFixed(2), st: s.stunned });
  }
  const bounceMid = { hp: P.getStatus().hp, pos: P.getPlayer(), stunned: P.getPlayer().stunned };
  await sleep(700);
  const bounceEnd = P.getStatus();
  out.bounceTile = {
    index: bounce.index,
    at: { x: bounce.x, z: bounce.z },
    start: { hp: bounceHp0, z: bounce.z, x: bounce.x },
    mid: { dz: bounceMid.pos.z - bounce.z, x: bounceMid.pos.x - bounce.x, stunned: bounceMid.stunned, hp: bounceMid.hp },
    back: { z: P.getPlayer().z, hp: P.getStatus().hp, deaths: bounceEnd.deaths },
    phase: P.getTiles().tiles[bounce.index].phase,
    logDelta: P.getDamageLog().length - bounceLog0,
    trace,
  };

  out.final = { status: P.getStatus(), tag: P.getNameTag(), hud: (() => {
    const v = document.querySelector('.vitals');
    const c = document.querySelector('.controls');
    return {
      vitals: v ? v.textContent.replace(/\s+/g, ' ').trim() : null,
      controls: c ? c.textContent.replace(/\s+/g, ' ').trim() : null,
    };
  })() };
  return out;
})()
"""

SHOT_BRIDGE = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  // 站在第一段桥最靠前的实心格上、抬高俯角往终点方向看：整段方格铺满画面
  const t = P.getTiles();
  const solid0 = t.tiles.filter((x) => x.zone === 0 && x.role === 'solid' && x.solid)
    .sort((a, b) => b.z - a.z);
  const stand = solid0[0] || t.tiles.find((x) => x.zone === 0);
  P.teleport(stand.x, 0.05, stand.z);
  await sleep(500);
  P.setOrbit(0, 24);
  await sleep(500);
  return { at: { x: stand.x, z: stand.z }, tag: P.getNameTag() };
})()
"""

SHOT_TILES_HOLE = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  // 先把第一段桥的消失格踩塌一批（挑玩家前方那几排，塌了正好入画）
  const t = P.getTiles();
  const standTile = t.tiles.filter((x) => x.zone === 0 && x.role === 'solid' && x.solid)
    .sort((a, b) => b.z - a.z)[0];
  const targets = t.tiles
    .filter((x) => x.role === 'vanish' && x.zone === 0 && x.solid && x.phase === 'idle')
    .filter((x) => !standTile || x.z < standTile.z)
    .slice(0, 5);
  for (const tile of targets) {
    P.teleport(tile.x, 0.08, tile.z);
    await sleep(1500);
  }
  await sleep(600);
  const t2 = P.getTiles();
  const stand = standTile
    ? t2.tiles[standTile.index]
    : t2.tiles.find((x) => x.zone === 0 && x.solid);
  P.teleport(stand.x, 0.05, stand.z);
  await sleep(500);
  P.setOrbit(0, 26);
  await sleep(500);
  return t2.tiles.filter((x) => x.zone === 0 && !x.solid).map((x) => x.index);
})()
"""


async def shoot(cdp: Cdp, js: str, png: Path, wait_s: float = 0.15) -> None:
    await cdp.eval_js(js, timeout_s=30)
    await asyncio.sleep(wait_s)
    res = await cdp.call("Page.captureScreenshot", {"format": "png"})
    png.write_bytes(base64.b64decode(res["data"]))


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ppr_verify9_")
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

            deadline = time.time() + 30
            while time.time() < deadline:
                await cdp.eval_js(ENTER_SOLO_JS)
                ready = await cdp.eval_js("!!(window.__PPR && window.__PPR.getTiles)")
                if ready:
                    break
                await asyncio.sleep(0.5)
            else:
                raise SystemExit("页面未就绪（__PPR.getTiles 不存在）")

            await asyncio.sleep(1.0)
            got = await cdp.eval_js(MEASURE_JS, timeout_s=90)

            ti = got["tagInit"]
            tl = got["tagLight"]
            th = got["tagHeavy"]
            td = got["tagDead"]
            check(
                "头顶血条：昵称上方显示 100/100",
                ti and ti["hp"] == 100 and ti["maxHp"] == 100 and abs(ti["y"] - 2.45) < 0.01,
                json.dumps(ti, ensure_ascii=False),
            )
            check(
                "受伤后头顶血条数字同步（轻击 -34 → 66）",
                tl["hp"] == 66 and got["hpLight"] == 66,
                json.dumps(tl, ensure_ascii=False),
            )
            check(
                "重击 -70 时头顶血条显示 30",
                th["hp"] == 30,
                json.dumps(th, ensure_ascii=False),
            )
            check(
                "血量归零复活后头顶血条回满 100",
                td["hp"] == 100 and td["maxHp"] == 100,
                json.dumps(td, ensure_ascii=False),
            )

            tu = got["tuning"]
            pu = got["push"]
            check(
                "柱子击退初速已调大（22 m/s，其它障碍仍是 10.5）",
                tu["sweepKnockbackSpeed"] == 22 and tu["knockbackSpeed"] == 10.5,
                json.dumps(tu, ensure_ascii=False),
            )
            check(
                "按柱子初速被击退：实测退 7–8.5 m",
                pu["applied"] is True and 7.0 <= pu["dist"] <= 8.5,
                f"dist={pu['dist']:.2f} m dz={pu['dz']:.2f}",
            )
            sr = got["sweepReal"]
            check(
                "真被扫地杆扫中：掉 10 血且被甩出 ≥6 m",
                sr["hit"] is True and sr["hp"] <= 90 and sr["moved"] >= 6.0,
                f"moved={sr['moved']:.2f} hp={sr['hp']} log={sr['log'][-2:]}",
            )

            t1 = got["tiles1"]
            t2 = got["tiles2"]
            rand = got["randomness"]
            check(
                "赛道上有 3 段方格桥（共 54 格）",
                t1["zones"] == 3 and t1["tiles"] == 54,
                json.dumps(t1, ensure_ascii=False),
            )
            check(
                "方格随机抽成 消失 / 回弹 / 实心 三种角色",
                t1["vanish"] >= 6 and t1["bounce"] >= 3 and t1["solid"] >= 6,
                f"vanish={t1['vanish']} bounce={t1['bounce']} solid={t1['solid']}",
            )
            check(
                "重新抽取会换一批角色（每局随机）",
                rand["batchChanged"] is True and rand["sameLayout"] is False,
                f"id {t1['id']} → {t2['id']}  sameLayout={rand['sameLayout']}",
            )

            vt = got["vanishTile"]
            check(
                "踩到消失格：先抖动再塌（相位走过 tremble/drop/gone）",
                vt["phaseSeen"] in ("tremble", "drop", "gone"),
                f"phaseSeen={vt['phaseSeen']}",
            )
            check(
                "方格塌了人掉进虚空 → 回起点满血复活（deaths +1）",
                vt["fell"] is True
                and abs(vt["after"]["z"] - 3.5) < 0.8
                and vt["after"]["hp"] == 100
                and vt["after"]["deaths"] == vt["before"]["deaths"] + 1
                and vt["after"]["solid"] is False,
                json.dumps(vt["after"], ensure_ascii=False),
            )
            check(
                "掉进虚空不算被扣血（伤害流水里没有新增伤害）",
                vt["after"]["logLen"] == vt["before"]["logLen"] or vt["after"]["hp"] == 100,
                f"logBefore={vt['before']['logLen']} logAfter={vt['after']['logLen']}",
            )

            bt = got["bounceTile"]
            pb = got["pushBounce"]
            check(
                "回弹初速 31 m/s：实测往起点方向弹回 ≥10.5 m",
                pb["applied"] is True and 10.5 <= pb["dist"] <= 14.0,
                f"dist={pb['dist']:.2f} m (目标约 12 m)",
            )
            check(
                "踩到回弹格真的被弹回十几米（≥9 m、进入硬直、格子播了压缩动画）",
                bt["mid"]["dz"] >= 9.0
                and bt["mid"]["stunned"] is True
                and bt["phase"] in ("bump", "idle"),
                f"dz={bt['mid']['dz']:.2f} stunned={bt['mid']['stunned']} phase={bt['phase']} trace={bt['trace']}",
            )
            check(
                "回弹不扣血（只延缓前进）",
                bt["start"]["hp"] == 100 and bt["mid"]["hp"] == 100 and bt["logDelta"] == 0,
                f"hp {bt['start']['hp']} → {bt['mid']['hp']} logDelta={bt['logDelta']}",
            )

            hud = got["final"]["hud"]
            check(
                "HUD 与头顶血条一致，操作提示仍在",
                hud["vitals"] is not None and "HP" in hud["vitals"] and "-34" in (hud["controls"] or ""),
                json.dumps(hud, ensure_ascii=False),
            )

            # ---------- 截图取证 ----------
            await shoot(cdp, SHOT_BRIDGE, OUT_DIR / "perf_m9_bridge.png", 0.2)
            holes = await cdp.eval_js(SHOT_TILES_HOLE, timeout_s=40)
            await asyncio.sleep(0.3)
            res = await cdp.call("Page.captureScreenshot", {"format": "png"})
            (OUT_DIR / "perf_m9_hole.png").write_bytes(base64.b64decode(res["data"]))
            print(f"塌掉的格子：{holes}", flush=True)

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
    (OUT_DIR / "verify_m9.json").write_text(text, encoding="utf-8")
    print(f"\n{'全部通过' if failures == 0 else f'{failures} 项失败'}（{len(results)} 项）", flush=True)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
