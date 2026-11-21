"""读取题库 xlsx，导出 JSON 结构供后续生成游戏数据。"""

import json
import sys
from pathlib import Path

from openpyxl import load_workbook


def main() -> int:
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])

    wb = load_workbook(src, data_only=True)
    info = {"sheets": [], "rows": {}}
    for ws in wb.worksheets:
        rows = []
        for row in ws.iter_rows(values_only=True):
            rows.append(["" if c is None else str(c).strip() for c in row])
        info["sheets"].append(
            {"title": ws.title, "max_row": ws.max_row, "max_col": ws.max_column}
        )
        info["rows"][ws.title] = rows

    out.write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")

    for s in info["sheets"]:
        print(f"[sheet] {s['title']} rows={s['max_row']} cols={s['max_col']}")
    for title, rows in info["rows"].items():
        print(f"--- {title} 前 6 行 ---")
        for r in rows[:6]:
            print(r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
