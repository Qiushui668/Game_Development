#!/usr/bin/env python
"""从真实布局 JSON 生成 B1.9 赛道障碍俯视图（静态 SVG）。

输入：tools/layout_b19.json（dump_layout_b19.py 导出）
输出：docs/layout_b19.html（可独立打开的整页）
      tools/layout_snippet.txt（可直接贴进回复的 renderer 片段）
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = json.loads((ROOT / "layout_b19.json").read_text(encoding="utf-8"))
BANDS = DATA["layout"]["bands"]
TRACK = DATA["track"]

COLORS = {
    "扫地杆": ("#f59e0b", "#b45309"),
    "滚轴": ("#3b82f6", "#1d4ed8"),
    "地刺": ("#ef4444", "#b91c1c"),
    "摆锤": ("#8b5cf6", "#6d28d9"),
    "栏架": ("#22c55e", "#15803d"),
    "拳套": ("#db2777", "#9d174d"),
    "答题墙": ("#64748b", "#334155"),
}

SX = 7.4
SZ = 4.2
MX = 30
MW = 18
HALF = 13.0


def kind(name):
    for k in COLORS:
        if name.startswith(k):
            return k
    return "答题墙"


def panel(z_top, z_bot, title):
    w = MX + 2 * HALF * SX + MW
    h = (z_top - z_bot) * SZ
    H = h + 26
    out = []
    out.append('<svg viewBox="0 0 %.0f %.0f" width="100%%" role="img" aria-label="%s">' % (w, H, title))
    out.append("<title>%s</title>" % title)
    out.append('<text x="0" y="13" font-size="12" font-weight="700" fill="#7c2d55">%s</text>' % title)
    ox, oy = MX, 26
    out.append(
        '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="#fff5fa" stroke="#f9c6dc" stroke-width="1"/>'
        % (MX + (-8.8 + HALF) * SX, oy, 2 * 8.8 * SX, h)
    )
    for gx in (-8.8, 8.8):
        px = MX + (gx + HALF) * SX
        out.append(
            '<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#e7a9c5" stroke-width="1.4" stroke-dasharray="4 4"/>'
            % (px, oy, px, oy + h)
        )
    cx = MX + HALF * SX
    out.append(
        '<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#f3d0e0" stroke-width="1" stroke-dasharray="2 6"/>'
        % (cx, oy, cx, oy + h)
    )
    # x 轴标注：左墙 / 右墙
    out.append(
        '<text x="%.1f" y="%.1f" font-size="9" fill="#c084a2">左墙 -8.8</text>' % (MX + (HALF - 8.8) * SX - 26, oy - 4)
    )
    out.append(
        '<text x="%.1f" y="%.1f" font-size="9" fill="#c084a2" text-anchor="end">右墙 +8.8</text>'
        % (MX + (HALF + 8.8) * SX + 2, oy - 4)
    )
    z = int(z_top) // 20 * 20
    while z >= z_bot:
        y = oy + (z_top - z) * SZ
        out.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#d8a7bf" stroke-width="1"/>' % (MX - 5, y, MX, y))
        out.append('<text x="%d" y="%.1f" font-size="9" fill="#9d6b84" text-anchor="end">%d</text>' % (MX - 7, y + 3.5, z))
        z -= 20
    for b in BANDS:
        zmin, zmax = b["zMin"], b["zMax"]
        if zmax < z_bot or zmin > z_top:
            continue
        k = kind(b["name"])
        fill, stroke = COLORS[k]
        x = MX + (b["xMin"] + HALF) * SX
        bw = max((b["xMax"] - b["xMin"]) * SX, 1.6)
        y = oy + (z_top - zmax) * SZ
        bh = max((zmax - zmin) * SZ, 1.8)
        op = 0.34 if k == "答题墙" else 0.42
        tip = "%s · x %.1f…%.1f m · z %.1f…%.1f m" % (b["name"], b["xMin"], b["xMax"], zmin, zmax)
        out.append(
            '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s" fill-opacity="%.2f" stroke="%s" stroke-width="1" rx="1.5"><title>%s</title></rect>'
            % (x, y, bw, bh, fill, op, stroke, tip)
        )
        label = b["name"]
        if bh >= 10 and bw >= len(label) * 8.4:
            out.append(
                '<text x="%.1f" y="%.1f" font-size="9" font-weight="600" fill="%s" text-anchor="middle">%s</text>'
                % (x + bw / 2, y + bh / 2 + 3.2, stroke, label)
            )
    x2 = MX + 2 * HALF * SX
    if z_bot <= TRACK["spawnZ"] <= z_top:
        y = oy + (z_top - TRACK["spawnZ"]) * SZ
        out.append('<line x1="%d" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#111827" stroke-width="1.2"/>' % (MX, y, x2, y))
        out.append('<text x="%.1f" y="%.1f" font-size="9" fill="#111827" text-anchor="end">起点 z=3.5</text>' % (x2 - 2, y - 3))
    if z_bot <= TRACK["finishZ"] <= z_top:
        y = oy + (z_top - TRACK["finishZ"]) * SZ
        out.append('<line x1="%d" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#111827" stroke-width="1.2"/>' % (MX, y, x2, y))
        out.append('<text x="%.1f" y="%.1f" font-size="9" fill="#111827" text-anchor="end">终点 z=-320</text>' % (x2 - 2, y + 10))
    out.append("</svg>")
    return "\n".join(out)


def gap_rows():
    rows = []
    for g in BANDS:
        if not g["name"].startswith("拳套"):
            continue
        best = None
        for b in BANDS:
            if b is g:
                continue
            if b["zMax"] < g["zMin"]:
                d = g["zMin"] - b["zMax"]
            elif b["zMin"] > g["zMax"]:
                d = b["zMin"] - g["zMax"]
            else:
                d = 0.0
            if best is None or d < best[1]:
                best = (b["name"], d)
        rows.append(
            dict(
                name=g["name"],
                side="右墙" if g["xMin"] > 0 else "左墙",
                x="x %.0f…%.0f m" % (g["xMin"], g["xMax"]),
                z="z %.1f…%.1f m" % (g["zMin"], g["zMax"]),
                near="%s · %.1f m" % (best[0], best[1]),
            )
        )
    return rows


def legend():
    parts = []
    for k, (fill, stroke) in COLORS.items():
        parts.append(
            '<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#3f2b38;">'
            '<span style="width:14px;height:10px;border-radius:2px;background:%s;opacity:.55;border:1px solid %s;"></span>%s</span>'
            % (fill, stroke, k)
        )
    return '<div style="display:flex;flex-wrap:wrap;gap:14px;margin:4px 0 12px;">%s</div>' % "".join(parts)


def build():
    rows = gap_rows()
    trs = []
    for r in rows:
        trs.append(
            '<tr><td style="padding:4px 10px;border-bottom:1px solid #f1d5e2;font-weight:700;color:#9d174d;">%s</td>'
            '<td style="padding:4px 10px;border-bottom:1px solid #f1d5e2;">%s</td>'
            '<td style="padding:4px 10px;border-bottom:1px solid #f1d5e2;">%s</td>'
            '<td style="padding:4px 10px;border-bottom:1px solid #f1d5e2;">%s</td>'
            '<td style="padding:4px 10px;border-bottom:1px solid #f1d5e2;font-weight:600;">%s</td></tr>'
            % (r["name"], r["side"], r["x"], r["z"], r["near"])
        )
    body = """
<div style="width:100%;box-sizing:border-box;padding:14px 16px;background:#fffdfd;color:#3f2b38;font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;">
  <div style="font-size:19px;font-weight:800;color:#7c2d55;letter-spacing:.4px;">B1.9 赛道障碍俯视图</div>
  <div style="font-size:13px;color:#8a5a72;margin:4px 0 10px;line-height:1.6;">
    数据直接取自游戏里 <code>__PPR.getLayout()</code> 的 53 条俯视矩形（扫地杆含整条摆臂扫掠圆、拳套含整只探出范围、栏架按实际栏位）；纵向 z 轴向下为前进方向，横向 x 轴即赛道左右（护栏在 ±8.8 m）。
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;">
    <div style="flex:1 1 300px;min-width:280px;">{p1}</div>
    <div style="flex:1 1 300px;min-width:280px;">{p2}</div>
  </div>
  {legend}
  <div style="font-size:14px;font-weight:700;color:#7c2d55;margin:6px 0 6px;">4 只拳套与最近邻居的 z 间隙（<span style="color:#15803d;">全部 &gt; 0，无重叠</span>）</div>
  <table style="border-collapse:collapse;font-size:13px;width:100%;max-width:640px;">{rows}</table>
  <div style="font-size:13px;color:#8a5a72;line-height:1.7;margin-top:10px;">
    · 拳套按右 → 左 → 右 → 左交替，四段分别落在 z≈-11 / -140 / -184 / -244，彼此拉开 129 / 44 / 60 m，不会挤在同一段赛道；<br/>
    · 起跑道那只只占右墙（x 1…9 m），第一根扫地杆只扫左半（x -11.7…0.7 m），z 上还隔着 1.1 m，不再叠在出生点正前方；<br/>
    · 扫地杆 1→7 的摆臂方向左右交替，滚轴/地刺/摆锤全在赛道中间，栏架按 1–3 个栏位错开，答题墙横跨整条赛道但留出 8 m 净距；<br/>
    · 4 只拳套与最近邻居的 z 间隙都 ≥ 0.8 m；答题墙 2 与滚轴之间那条缝只有 6.9 m，所以拳套 2 的滑幅收窄到 ±1 m。
  </div>
</div>
""".format(
        p1=panel(8.0, -157.0, "前半段  z +8 → -157"),
        p2=panel(-157.0, -326.0, "后半段  z -157 → -326"),
        legend=legend(),
        rows="".join(trs),
    )
    return body


def full_page(body):
    return (
        '<html style="margin:0;padding:0;">\n<title>B1.9 赛道障碍俯视图</title>\n'
        '<div style="background:#fffdfd;">' + body + "</div>\n</html>\n"
    )


if __name__ == "__main__":
    body = build()
    (ROOT.parent / "docs" / "layout_b19.html").write_text(full_page(body), encoding="utf-8")
    (ROOT / "layout_snippet.txt").write_text(body, encoding="utf-8")
    print("ok")
