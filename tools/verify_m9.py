#!/usr/bin/env python
"""B1.7 验收：赛道方格（随机散落 + 外观无差异）+ 昵称必须自己输入。

用法：.venv\\Scripts\\python.exe tools\\verify_m9.py [url]

和 B1.6 版的区别：整条赛道已经铺满 684 块 3 m 方格（不再有"3 段方格桥"），
所以随机性没法靠"桥段位置"来锚，改用调试钩子把它们钉到指定格子上：
  setTileRole(index, 'vanish' | 'bounce') → 验证踩塌 / 回弹
  clearTiles()                            → 先全部实心，排除其它格子干扰
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

# 进游戏前：昵称门那两个断言（输入框必须为空、空着不能进）
GATE_JS = r"""
(() => {
  const input = document.querySelector('.gate-input');
  const go = document.querySelector('.gate-go');
  return {
    hasInput: !!input,
    value: input ? input.value : null,
    placeholder: input ? input.placeholder : null,
    required: input ? input.required : null,
    autocomplete: input ? input.getAttribute('autocomplete') : null,
    goDisabled: go ? go.disabled : null,
    goText: go ? go.textContent.replace(/\s+/g, ' ').trim() : null,
    body: document.body.innerText.slice(0, 200),
  };
})()
"""

MEASURE_JS = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  await sleep(300);
  // 整条赛道默认铺满随机陷阱：先全部变回实心，保证下面各项测量不被随机塌陷/回弹干扰
  // （消失格 / 回弹格单独用 setTileRole 钉到指定位置再测）
  out.clearReturn = P.clearTiles();
  await sleep(200);

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
  P.teleport(1.5, 0.05, 2);
  await sleep(200);

  // ---------- 2. 柱子击退 ----------
  out.tuning = P.getTuning();
  // 纯速度测量放在 z≈-8（第一根扫地杆 -22 的摆臂够不到，+z 方向一路空档），
  // 站在 -20 会被摆臂在 1.4 s 等待期里二次击中，测出来的距离不干净
  P.teleport(1.5, 0.05, -8);
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

  // ---------- 3. 全赛道方格网 ----------
  // 前面为了测量干净把陷阱清掉了，这里重新随机一批再数（等价于"每局开局抽签"）
  P.rerollTiles();
  await sleep(200);
  const t1 = P.getTiles();
  const count = (arr, r) => arr.filter((x) => x.role === r).length;
  const summarize = (t) => {
    const vanish = t.tiles.filter((x) => x.role === 'vanish');
    const bounce = t.tiles.filter((x) => x.role === 'bounce');
    const rowsOf = (arr) => (arr.length ? [Math.min(...arr.map((x) => x.row)), Math.max(...arr.map((x) => x.row))] : [null, null]);
    const colsOf = (arr) => [...new Set(arr.map((x) => x.col))].sort((a, b) => a - b);
    // 把整条赛道（342 m）切成 10 段，看陷阱铺到了几段：判断"是不是散落在任意位置"
    const SEG = 10;
    const segsOf = (arr) => {
      const span = t.grid.zStart - t.grid.zEnd;
      return [...new Set(arr.map((x) => Math.min(SEG - 1, Math.floor(((t.grid.zStart - x.z) / span) * SEG))))].sort((a, b) => a - b);
    };
    // 相邻陷阱之间的最大空档（米）：3 段桥上才会出现的那种"一整段赛道没陷阱"
    const maxGapOf = (arr) => {
      const zs = arr.map((x) => x.z).sort((a, b) => b - a);
      if (zs.length < 2) return 999;
      let gap = 0;
      for (let i = 1; i < zs.length; i++) gap = Math.max(gap, zs[i - 1] - zs[i]);
      return +gap.toFixed(1);
    };
    return {
      id: t.assignmentId,
      grid: t.grid,
      tiles: t.tiles.length,
      vanish: vanish.length,
      bounce: bounce.length,
      solid: count(t.tiles, 'solid'),
      vanishRows: rowsOf(vanish),
      bounceRows: rowsOf(bounce),
      vanishCols: colsOf(vanish),
      bounceCols: colsOf(bounce),
      vanishSegs: segsOf(vanish),
      bounceSegs: segsOf(bounce),
      allSegs: segsOf([...vanish, ...bounce]),
      maxGapAll: maxGapOf([...vanish, ...bounce]),
      vanishZ: vanish.length ? [Math.min(...vanish.map((x) => x.z)), Math.max(...vanish.map((x) => x.z))] : null,
      bounceZ: bounce.length ? [Math.min(...bounce.map((x) => x.z)), Math.max(...bounce.map((x) => x.z))] : null,
      // 用于判断"每局是否换了一批"：身份序列
      roles: t.tiles.map((x) => x.role[0]).join(''),
    };
  };
  out.tiles1 = summarize(t1);
  out.render = P.getTileRender();

  const id1 = P.rerollTiles();
  const t2 = P.getTiles();
  out.tiles2 = summarize(t2);
  out.randomness = {
    sameLayout: out.tiles1.roles === out.tiles2.roles,
    batchChanged: out.tiles2.id > out.tiles1.id,
    rerollReturned: id1,
  };

  // ---------- 4. 外观一致性：从实例矩阵读每块的真实尺寸 ----------
  // 世界坐标反查格子下标（6 列 3 m，原点在赛道中线）
  const idxAt = (x, z) => {
    const g = P.getTiles().grid;
    const half = (g.cell * g.cols) / 2;
    const col = Math.floor((x + half) / g.cell);
    const row = Math.floor((g.zStart - z) / g.cell);
    return row * g.cols + col;
  };

  // ---------- 5. 消失格：踩塌 → 掉虚空 → 回起点满血 ----------
  // 钉在 z≈-11.5（第一根扫地杆 -22 之前，两侧没有实体障碍），先清掉所有随机身份
  P.clearTiles();
  await sleep(120);
  const voidIdx = idxAt(-4.5, -11.5);
  const voidSet = P.setTileRole(voidIdx, 'vanish');
  const voidDef = P.getTiles().tiles[voidIdx];
  P.resetHealth();
  await sleep(120);
  P.teleport(voidDef.x, 0.08, voidDef.z);
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
  while (performance.now() - tFall < 5000) {
    const st = P.getTiles().tiles[voidIdx];
    if (st && (st.phase === 'tremble' || st.phase === 'drop' || st.phase === 'gone')) phaseSeen = st.phase;
    if (P.getPlayer().z > 2.0) { fell = true; break; }
    await sleep(30);
  }
  await sleep(700);
  const voidTileAfter = P.getTiles().tiles[voidIdx];
  out.vanishTile = {
    set: voidSet,
    index: voidIdx,
    at: { x: voidDef.x, z: voidDef.z },
    phaseSeen,
    fell,
    before: vanishBefore,
    after: {
      hp: P.getStatus().hp,
      deaths: P.getStatus().deaths,
      z: P.getPlayer().z,
      x: P.getPlayer().x,
      solid: voidTileAfter.solid,
      phase: voidTileAfter.phase,
      logLen: P.getDamageLog().length,
      damageLog: P.getDamageLog().slice(-3).map((d) => ({ amount: d.amount, cause: d.cause })),
    },
  };

  // ---------- 6. 回弹格：往起点弹十几米、不扣血 ----------
  // 先清空随机身份，只把 z≈-17.5 那一块钉成回弹格（正前方 12 m 内没有任何实体）
  // 量点固定走左半边（x=-4.5）：B1.9 把起跑道拳套挪到右墙 z≈-11 后，x=1.5 会落进它的
  // 出拳范围，"纯速度衰减"会被拳套打飞打断（实测 hp 归零、复活后带着残余速度多滑 2.5 m）。
  P.clearTiles();
  await sleep(150);
  const bumpIdx = idxAt(1.5, -17.5);
  const bumpSet = P.setTileRole(bumpIdx, 'bounce');
  const bumpDef = P.getTiles().tiles[bumpIdx];

  // 先把"回弹初速"本身量一遍：纯速度衰减算退距（目标约 12 m）
  // 位置选 z≈-8 的左半边：第一根扫地杆在 -22 够不到、-40 的地刺也够不到，前方 +z 一路空档；
  // x=-4.5 同时避开右墙拳套（拳套只探到 x≥1）
  P.resetHealth();
  P.teleport(-4.5, 0.05, -8);
  await sleep(250);
  const bpFrom = P.getPlayer();
  const bpApplied = P.pushPlayer(0, 1, out.tuning.tileBounceSpeed, 12, out.tuning.tileBounceStun);
  // 采样轨迹：确认这 1.5 s 里没被拳套/别的障碍打断（拳套 1 就在右墙 z≈-11）
  const bpTrace = [];
  for (let i = 0; i < 15; i++) {
    await sleep(100);
    const s = P.getPlayer();
    const st = P.getStatus();
    const g1 = P.getGloves().stations[0];
    bpTrace.push({
      t: (i + 1) * 100,
      z: +(s.z - bpFrom.z).toFixed(2),
      hp: st.hp,
      deaths: st.deaths,
      gz: +g1.z.toFixed(2),
      ge: +g1.extend.toFixed(2),
    });
  }
  const bpTo = P.getPlayer();
  out.pushBounce = {
    applied: bpApplied,
    speed: out.tuning.tileBounceSpeed,
    dist: Math.hypot(bpTo.x - bpFrom.x, bpTo.z - bpFrom.z),
    dz: bpTo.z - bpFrom.z,
    trace: bpTrace,
  };

  P.resetHealth();
  await sleep(200);
  // 清场之后重新钉一次（上面那次推人可能已经把这一格踩过）
  P.setTileRole(bumpIdx, 'bounce');
  const bumpHp0 = P.getStatus().hp;
  const bumpLog0 = P.getDamageLog().length;
  // 踩上去瞬间就被弹走，"起点"必须取格子坐标本身，不能等 100+ ms 后读位置
  P.teleport(bumpDef.x, 0.08, bumpDef.z);
  const trace = [];
  for (let i = 0; i < 9; i++) {
    await sleep(100);
    const s = P.getPlayer();
    trace.push({ t: (i + 1) * 100, z: +(s.z - bumpDef.z).toFixed(2), y: +s.y.toFixed(2), sp: +s.speed.toFixed(2), st: s.stunned });
  }
  const bumpMid = { hp: P.getStatus().hp, pos: P.getPlayer(), stunned: P.getPlayer().stunned };
  await sleep(700);
  const bumpEnd = P.getStatus();
  out.bounceTile = {
    set: bumpSet,
    index: bumpIdx,
    at: { x: bumpDef.x, z: bumpDef.z },
    start: { hp: bumpHp0, z: bumpDef.z, x: bumpDef.x },
    mid: { dz: bumpMid.pos.z - bumpDef.z, x: bumpMid.pos.x - bumpDef.x, stunned: bumpMid.stunned, hp: bumpMid.hp },
    back: { z: P.getPlayer().z, hp: P.getStatus().hp, deaths: bumpEnd.deaths },
    phase: P.getTiles().tiles[bumpIdx].phase,
    logDelta: P.getDamageLog().length - bumpLog0,
    trace,
  };

  // 恢复：把钉过的两块改回实心，免得影响后面的截图
  P.clearTiles();

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

SHOT_TRACK = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  P.clearTiles();
  // 站在起点平台边上的第一排方格上、抬高俯角往终点方向看：整条赛道铺满同一种方格
  const t = P.getTiles();
  const first = t.tiles.filter((x) => x.solid).sort((a, b) => b.z - a.z)[0];
  P.teleport(first.x, 0.05, first.z);
  await sleep(500);
  P.setOrbit(0, 24);
  await sleep(500);
  return { at: { x: first.x, z: first.z }, tag: P.getNameTag() };
})()
"""

SHOT_TILES_HOLE = r"""
(async () => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  const g = P.getTiles().grid;
  const idxAt = (x, z) => {
    const half = (g.cell * g.cols) / 2;
    return Math.floor((g.zStart - z) / g.cell) * g.cols + Math.floor((x + half) / g.cell);
  };
  P.clearTiles();
  await sleep(120);
  // 在起点平台前方（z -2.5..-11.5 那 4 排）把中间几块钉成消失格，然后挨个踩塌
  const targets = [];
  for (const row of [7, 8, 9, 10]) {
    for (const x of [-4.5, -1.5, 1.5]) {
      const i = idxAt(x, 20 - 3 * (row + 0.5));
      if (i >= 0) targets.push(i);
    }
  }
  for (const i of targets) P.setTileRole(i, 'vanish');
  for (const i of targets) {
    const def = P.getTiles().tiles[i];
    P.teleport(def.x, 0.08, def.z);
    await sleep(1200);
  }
  await sleep(800);
  // 退到起点平台上往下看
  P.teleport(1.5, 0.05, 2);
  await sleep(400);
  P.setOrbit(0, 26);
  await sleep(500);
  return P.getTiles().tiles.filter((x) => !x.solid).map((x) => x.index);
})()
"""


async def shoot(cdp: Cdp, js: str, png: Path, wait_s: float = 0.15) -> None:
    await cdp.eval_js(js, timeout_s=40)
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

            # ---------- 0. 昵称门：必须自己输入，不能有默认值 / 不能为空 ----------
            gate = None
            deadline = time.time() + 30
            while time.time() < deadline:
                gate = await cdp.eval_js(GATE_JS)
                if gate and gate.get("hasInput"):
                    break
                gate = None
                await asyncio.sleep(0.5)
            if gate is None:
                raise SystemExit("昵称门没出现（.gate-input 不存在）")
            await asyncio.sleep(0.4)
            await shoot(cdp, "(() => document.querySelector('.gate-input').focus())()", OUT_DIR / "perf_m9_gate.png", 0.2)
            check(
                "昵称输入框没有默认值（初始为空）",
                gate["value"] == "" and gate["required"] is True,
                json.dumps({k: gate[k] for k in ("value", "placeholder", "required", "autocomplete")}, ensure_ascii=False),
            )
            check(
                "昵称为空时「进入游戏」不可用（不能空着进）",
                gate["goDisabled"] is True,
                json.dumps({"goDisabled": gate["goDisabled"], "goText": gate["goText"]}, ensure_ascii=False),
            )

            # ---------- 进游戏 ----------
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
            got = await cdp.eval_js(MEASURE_JS, timeout_s=120)

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
                "柱子击退初速仍是 22 m/s（其它障碍 10.5）",
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

            # ---------- 方格 ----------
            t1 = got["tiles1"]
            t2 = got["tiles2"]
            grid = t1["grid"]
            check(
                "整条赛道铺满方格：6 列 × 114 行 = 684 块 3 m 方格（z 20 → -322）",
                grid["cols"] == 6
                and grid["rows"] == 114
                and grid["cell"] == 3
                and grid["zStart"] == 20
                and grid["zEnd"] == -322
                and t1["tiles"] == 684,
                json.dumps(grid, ensure_ascii=False),
            )

            rd = got["render"]
            check(
                "每块格子外观完全一致：同一材质同一张贴图、无实例色、同尺寸同厚度",
                rd["instances"] == 684
                and rd["hasMap"] is True
                and rd["usesInstanceColor"] is False
                and rd["width"] == 3
                and rd["depth"] == 3
                and rd["thickness"] > 0,
                json.dumps(rd, ensure_ascii=False),
            )

            total = 684
            check(
                "开局随机抽身份：消失 / 回弹 / 实心三类齐备（约 4% / 2.5%）",
                t1["vanish"] + t1["bounce"] + t1["solid"] == total
                and 12 <= t1["vanish"] <= 48
                and 5 <= t1["bounce"] <= 34,
                f"vanish={t1['vanish']} bounce={t1['bounce']} solid={t1['solid']} (概率 {tu['tileVanishChance']}/{tu['tileBounceChance']})",
            )

            vz = t1["vanishZ"]
            bz = t1["bounceZ"]
            check(
                "陷阱散落在赛道任意位置（10 段等分里消失格铺到 ≥5 段、回弹格 ≥4 段、合计 ≥8 段，相邻陷阱空档 ≤150 m）",
                len(t1["vanishSegs"]) >= 5
                and len(t1["bounceSegs"]) >= 4
                and len(t1["allSegs"]) >= 8
                and t1["maxGapAll"] <= 150.0
                and len(t1["vanishCols"]) >= 3
                and len(t1["bounceCols"]) >= 2,
                f"消失段 {t1['vanishSegs']} · 回弹段 {t1['bounceSegs']} · 合计段 {t1['allSegs']} · 最大空档 {t1['maxGapAll']} m · "
                f"vanish z {vz} cols {t1['vanishCols']} · bounce z {bz} cols {t1['bounceCols']}",
            )
            check(
                "终点前 7 m 保底实心（-313 之后没有陷阱，压线不会掉下去）",
                t1["vanishZ"] is not None
                and t1["vanishZ"][0] > -313
                and t1["bounceZ"] is not None
                and t1["bounceZ"][0] > -313,
                f"vanishZ={t1['vanishZ']} bounceZ={t1['bounceZ']}",
            )
            check(
                "重新抽取会换一批身份（每局随机）",
                got["randomness"]["batchChanged"] is True and got["randomness"]["sameLayout"] is False,
                f"id {t1['id']} → {t2['id']} sameLayout={got['randomness']['sameLayout']}",
            )

            vt = got["vanishTile"]
            check(
                "踩到消失格：先抖动再塌（相位走过 tremble/drop/gone）",
                vt["set"] is True and vt["phaseSeen"] in ("tremble", "drop", "gone"),
                f"index={vt['index']} at={vt['at']} phaseSeen={vt['phaseSeen']}",
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
                f"dist={pb['dist']:.2f} m (目标约 12 m) trace={pb.get('trace')}",
            )
            check(
                "踩到回弹格真的被弹回十几米（≥9 m、进入硬直、格子播了压缩动画）",
                bt["set"] is True
                and bt["mid"]["dz"] >= 9.0
                and bt["mid"]["stunned"] is True
                and bt["phase"] in ("bump", "idle"),
                f"index={bt['index']} dz={bt['mid']['dz']:.2f} stunned={bt['mid']['stunned']} phase={bt['phase']} trace={bt['trace']}",
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
            await shoot(cdp, SHOT_TRACK, OUT_DIR / "perf_m9_track.png", 0.2)
            holes = await cdp.eval_js(SHOT_TILES_HOLE, timeout_s=60)
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
