"""B1.8 定稿取景：新版拳套几何，拍左墙 / 右墙 / 出拳三张。"""
from __future__ import annotations

import asyncio
import base64
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from perf_probe import Cdp, find_chrome, free_port, list_targets  # noqa: E402

OUT = Path(__file__).parent
URL = 'http://localhost:5173/'

SET_JS = r"""
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gi = document.querySelector('.gate-input');
  if (gi) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(gi, '验收员');
    gi.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    const go = document.querySelector('.gate-go');
    if (go && !go.disabled) { go.click(); await sleep(200); }
  }
  const solo = document.querySelector('.mode.solo');
  if (solo) solo.click();
  return true;
})()
"""

SHOT = r"""
async (idx, x, zOff, yaw, pitch, mode) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const P = window.__PPR;
  P.releaseInput();
  if (P.getRace().state !== 'Racing') P.startNow();
  P.clearTiles();
  const g = P.getGloves().stations[idx];
  P.teleport(x, 0.05, g.def.zCenter + zOff);
  await sleep(500);
  P.setOrbit(yaw, pitch);
  await sleep(900);
  for (let i = 0; i < 160; i++) {
    const e = P.getGloves().stations[idx].extend;
    if (mode === 'punch' ? e > 0.93 : e < 0.1) break;
    await sleep(50);
  }
  await sleep(30);
  const s = P.getGloves().stations[idx];
  return { idx, side: s.def.side, z: +s.z.toFixed(2), extend: +s.extend.toFixed(2) };
}
"""

VARIANTS = [
    ('rest_side', 0, -3.0, 6.0, 40, 10, 'rest'),
    ('punch_left_a', 0, -2.5, 9.0, -28, 8, 'punch'),
    ('wall_left', 0, 0.0, 11.0, 0, 7, 'rest'),
]


async def main() -> int:
    port = free_port()
    profile = tempfile.mkdtemp(prefix='ppr_gloveshot2_')
    proc = subprocess.Popen(
        [find_chrome(), f'--remote-debugging-port={port}', f'--user-data-dir={profile}',
         '--no-first-run', '--disable-background-timer-throttling', '--window-size=1280,760', URL],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        targets = list_targets(port)
        page = next((t for t in targets if t.get('type') == 'page'), None)
        from websockets import connect
        async with connect(page['webSocketDebuggerUrl'], max_size=32 * 1024 * 1024) as ws:
            cdp = Cdp(ws)
            await cdp.call('Runtime.enable')
            await asyncio.sleep(2.2)
            await cdp.eval_js(SET_JS)
            for _ in range(40):
                if await cdp.eval_js('!!(window.__PPR && window.__PPR.getGloves)'):
                    break
                await asyncio.sleep(0.4)
            for name, idx, x, zoff, yaw, pitch, mode in VARIANTS:
                info = await cdp.eval_js(
                    f'({SHOT})({idx}, {x}, {zoff}, {yaw}, {pitch}, "{mode}")', timeout_s=40)
                await asyncio.sleep(0.25)
                res = await cdp.call('Page.captureScreenshot', {'format': 'png'})
                (OUT / f'perf_b18_glove_{name}.png').write_bytes(base64.b64decode(res['data']))
                print(name, info, flush=True)
    finally:
        proc.terminate()
        shutil.rmtree(profile, ignore_errors=True)
    return 0


sys.exit(asyncio.run(main()))
