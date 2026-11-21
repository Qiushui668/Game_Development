"""把题库 JSON 转成游戏用的 TS 数据，并做一轮结构校验。"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

TS_HEADER = """/**
 * 题库数据：由 `tools/build_questions.py` 从「趣味选择题100题.xlsx」生成，勿手改。
 * 字段与源表一一对应：序号 / 题型 / 题目 / 选项A-D / 答案 / 答案解析。
 */

export interface QuizQuestion {
  /** 源表序号 */
  id: number
  /** 题型，如"脑筋急转弯" */
  category: string
  /** 题干 */
  text: string
  /** 四个选项，顺序固定 A/B/C/D */
  options: [string, string, string, string]
  /** 正确选项下标 0..3（A=0） */
  answer: number
  /** 答案解析 */
  explain: string
}

export const QUESTIONS: QuizQuestion[] = [
"""

TS_FOOTER = """] as const
"""


def js_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def main() -> int:
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])

    data = json.loads(src.read_text(encoding="utf-8"))
    rows = data["rows"]["趣味选择题100题"]
    header = rows[0]
    expected = ["序号", "题型", "题目", "选项A", "选项B", "选项C", "选项D", "答案", "答案解析"]
    if header[: len(expected)] != expected:
        raise SystemExit(f"表头不符：{header}")

    body = [r for r in rows[1:] if any(c for c in r)]
    items = []
    problems = []
    for r in body:
        r = (r + [""] * 9)[:9]
        idx, cat, text, a, b, c, d, ans, exp = (cell.strip() for cell in r)
        label = ans.upper()
        if label not in ("A", "B", "C", "D"):
            problems.append(f"序号 {idx}: 答案非法 {ans!r}")
            continue
        if not text or not all([a, b, c, d]):
            problems.append(f"序号 {idx}: 题干或选项为空")
            continue
        items.append(
            {
                "id": int(idx) if idx.isdigit() else len(items) + 1,
                "category": cat,
                "text": text,
                "options": [a, b, c, d],
                "answer": "ABCD".index(label),
                "explain": exp,
            }
        )

    if problems:
        print("校验未通过：")
        for p in problems:
            print(" -", p)
        return 1

    lines = [TS_HEADER]
    for it in items:
        opts = ", ".join(js_str(o) for o in it["options"])
        lines.append(
            "  {\n"
            f"    id: {it['id']},\n"
            f"    category: {js_str(it['category'])},\n"
            f"    text: {js_str(it['text'])},\n"
            f"    options: [{opts}],\n"
            f"    answer: {it['answer']},\n"
            f"    explain: {js_str(it['explain'])},\n"
            "  },\n"
        )
    lines.append(TS_FOOTER)
    out.write_text("".join(lines), encoding="utf-8")

    print(f"题目数 {len(items)}，写入 {out}")
    print("题型分布：", Counter(i["category"] for i in items))
    print("答案分布：", Counter("ABCD"[i["answer"]] for i in items))
    longest = max(items, key=lambda i: len(i["text"]))
    print("最长题干：", len(longest["text"]), longest["text"][:40])
    longest_opt = max((len(o), o) for i in items for o in i["options"])
    print("最长选项：", longest_opt)
    dup = [t for t, n in Counter(i["text"] for i in items).items() if n > 1]
    print("重复题干：", dup or "无")
    return 0


if __name__ == "__main__":
    sys.exit(main())
