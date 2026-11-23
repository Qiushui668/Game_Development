#!/usr/bin/env python
"""采样浮桥 6 块板的 x(t) 轨迹，给文档出图用（B2.0 摆动调整）。

用法：.venv\\Scripts\\python.exe tools\\probe_swing_b20.py
输出：tools\\bridge_swing.json（swingX / travelSeconds / 采样序列）
前置：Vite http://localhost:5173
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from verify_m7 import Page, click, free_port, open_page, set_input  # noqa: E402

OUT = Path(__file__).parent

SAMPLE_JS = """(async (ms) => {
  const P = window.__PPR;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  P.clearTiles();
  P.teleport(0, 0.05, 3.5);
  P.resetBridge();
  const t0 = performance.now();
  const rows = [];
  while (performance.now() - t0 < ms) {
    rows.push({
      t: (performance.now() - t0) / 1000,
      x: P.getBridge().platforms.map((p) => p.x),
    });
    await sleep(50);
  }
  const b = P.getBridge();
  return { swingX: b.swingX, travel: b.travelSeconds, rows };
})"""


async def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
    page: Page = await open_page(free_port(9611), url, "0,0", "1100,720", "swing")
    try:
        await page.wait("!!document.querySelector('.gate')", 25)
        await set_input(page, ".gate-input", "采样员")
        await asyncio.sleep(0.25)
        await click(page, ".gate-go")
        await page.wait("!!document.querySelector('.mode.solo')", 8)
        await click(page, ".mode.solo")
        await page.wait("!!(window.__PPR && window.__PPR.ready)", 40)
        data = await page.js(f"({SAMPLE_JS})(7000)")
    finally:
        page.close()
    (OUT / "bridge_swing.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    rows = data["rows"]
    print(f"swingX={data['swingX']} travel={data['travel']} samples={len(rows)}")
    for i in range(len(rows[0]["x"])):
        mn = min(r["x"][i] for r in rows)
        mx = max(r["x"][i] for r in rows)
        print(f"  plate{i + 1}: x in [{mn:.2f}, {mx:.2f}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
