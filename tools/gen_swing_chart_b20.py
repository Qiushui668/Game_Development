#!/python
"""把 bridge_swing.json 里的实测 x(t) 画成 HTML/SVG 图，供文档与回复引用。

用法：.venv\\Scripts\\python.exe tools\\gen_swing_chart_b20.py
输出：docs\\bridge_swing.html（再用 shot_html.py 截成 tools\\bridge_swing.png）
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA = ROOT / "tools" / "bridge_swing.json"
OUT = ROOT / "docs" / "bridge_swing.html"

W, H = 940, 420
PAD_L, PAD_R, PAD_T, PAD_B = 62, 96, 54, 44
COLORS = ["#22d0c8", "#ff5fa8", "#22d0c8", "#ff5fa8", "#22d0c8", "#ff5fa8"]


def build() -> str:
    d = json.loads(DATA.read_text(encoding="utf-8"))
    rows = d["rows"]
    swing = float(d["swingX"])
    travel = float(d["travel"])
    t_max = max(r["t"] for r in rows)
    x_max = swing * 1.25
    plot_w = W - PAD_L - PAD_R
    plot_h = H - PAD_T - PAD_B

    def px(t: float) -> float:
        return PAD_L + plot_w * (t / t_max)

    def py(x: float) -> float:
        return PAD_T + plot_h * (1 - (x + x_max) / (2 * x_max))

    parts: list[str] = []
    # 网格 + 边界
    for v in (-swing, 0, swing):
        y = py(v)
        dash = ' stroke-dasharray="5 5"' if abs(v) == swing else ""
        col = "#94a3b8" if abs(v) == swing else "#e2e8f0"
        parts.append(f'<line x1="{PAD_L}" y1="{y:.1f}" x2="{PAD_L + plot_w}" y2="{y:.1f}" stroke="{col}" stroke-width="1"{dash}/>')
        parts.append(f'<text x="{PAD_L - 8}" y="{y + 4:.1f}" font-size="12" fill="#64748b" text-anchor="end">{v:+.0f} m</text>')
    for t in range(0, int(t_max) + 1):
        x = px(t)
        parts.append(f'<line x1="{x:.1f}" y1="{PAD_T}" x2="{x:.1f}" y2="{PAD_T + plot_h}" stroke="#f1f5f9"/>')
        parts.append(f'<text x="{x:.1f}" y="{PAD_T + plot_h + 20}" font-size="12" fill="#64748b" text-anchor="middle">{t}s</text>')

    # 实测 6 条轨迹两两重合（镜像），画成"两条粗线 + 其余细线"最直观
    for i in range(len(rows[0]["x"])):
        pts = " ".join(f"{px(r['t']):.1f},{py(r['x'][i]):.1f}" for r in rows)
        wide = i < 2
        parts.append(
            f'<polyline points="{pts}" fill="none" stroke="{COLORS[i]}" '
            f'stroke-width="{2.6 if wide else 5.5}" opacity="{0.95 if wide else 0.18}"/>'
        )
    # 起点标注（只标两条代表曲线，避免 6 条重合文字打架；分别贴在 ±2 m 边界外侧）
    parts.append(
        f'<text x="{PAD_L + 10}" y="{py(-swing) + 20:.1f}" font-size="12.5" fill="#0f766e">块 1 / 3 / 5：起步 −2 m（最左）</text>'
    )
    parts.append(
        f'<text x="{PAD_L + 10}" y="{py(swing) - 10:.1f}" font-size="12.5" fill="#be185d">块 2 / 4 / 6：起步 +2 m（最右）</text>'
    )

    # 起点标注（只标两条曲线）已在上方绘制

    # 反向点标注
    for k in range(1, int(t_max / travel) + 1):
        x = px(k * travel)
        parts.append(f'<line x1="{x:.1f}" y1="{PAD_T}" x2="{x:.1f}" y2="{PAD_T + plot_h}" stroke="#fca5a5" stroke-width="1"/>')
    parts.append(
        f'<text x="{px(travel) + 6:.1f}" y="{PAD_T - 26}" font-size="12" fill="#b91c1c">每 {travel:.0f} s 撞到边界 → 立刻反号</text>'
    )

    return f"""<html style="margin:0;padding:0;background:#f8fafc;">
<title>浮桥 6 块横向摆动实测轨迹</title>
<div style="width:980px;height:568px;overflow:hidden;box-sizing:border-box;padding:18px 20px 22px;font-family:system-ui,'Microsoft YaHei',sans-serif;color:#0f172a;background:#f8fafc;">
  <div style="font-size:19px;font-weight:700;letter-spacing:.5px;">浮桥 6 块板 · 实测横向轨迹（单机跑图，每 50 ms 采样 7 s）</div>
  <div style="font-size:13px;color:#475569;margin:6px 0 12px;max-width:900px;line-height:1.55;">
    起点左右交替（块 1/3/5 → −2 m、块 2/4/6 → +2 m）；之后 6 块同时匀速扫，3 s 撞一次边界立刻反号，
    相邻两块永远镜像 —— 横向落差在 0 … 4 m 之间摆动，1.5 s、4.5 s 时全部对齐居中。
  </div>
  <svg viewBox="0 0 {W} {H}" width="{W}" height="{H}" style="display:block;">
    <rect x="0" y="0" width="{W}" height="{H}" fill="#ffffff" stroke="#e2e8f0" rx="10"/>
    {''.join(parts)}
  </svg>
  <div style="display:flex;flex-wrap:wrap;gap:10px 22px;font-size:12.5px;color:#475569;margin-top:10px;">
    <span><span style="display:inline-block;width:14px;height:3px;background:#22d0c8;vertical-align:middle;"></span> 块 1 / 3 / 5（起步最左）</span>
    <span><span style="display:inline-block;width:14px;height:3px;background:#ff5fa8;vertical-align:middle;"></span> 块 2 / 4 / 6（起步最右）</span>
    <span>虚线 = ±{swing:.0f} m 运动边界（物理与画面同一份数据）</span>
    <span>档距 5.5 m、板宽 3.6 m、冲刺平跳约 7.9 m</span>
  </div>
</div>
</html>
"""


def main() -> int:
    OUT.write_text(build(), encoding="utf-8")
    print(f"-> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
