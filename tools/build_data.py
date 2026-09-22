# -*- coding: utf-8 -*-
"""Build data/handbook.js from the scanned handbook plus the supplied supplements.

Pipeline：原始提取文本 → 清理扫描噪声 → 合并分页断裂 → 插入补充内容 →
建立引用位置索引（文档名 / 章 / 条）→ 用目录匹配定位每份文件。
"""

import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# OCR 留下的整行噪声：页码、页边标签、水印碎片。按整行精确匹配删除。
ARTIFACT_LINES = {
    "安很大學", "安爱大学", "安花大学", "李國大学", "安盛大学", "半镇大学",
    "半数大学", "事技大尊", "工自理", "官理", "微学管理", "数学格州", "打九",
    "安", "96 做好学", "的勤工助学", "教学管理", "数学管理", "评奖评优",
    "许实评优", "ANHUI UNIVERSITY",
}

CHAPTER_RE = re.compile(r"^第[一二三四五六七八九十百零〇]+章")
ARTICLE_RE = re.compile(r"^第[一二三四五六七八九十百零〇]+条")
HEADING_RE = re.compile(
    r"^(第[一二三四五六七八九十百零〇]+[条章节]|[一二三四五六七八九十]+[、．.]"
    r"|[（(][一二三四五六七八九十\d]+[）)]|\d+[、．.]|附\s*[录件]|承诺人)"
)
SENTENCE_END = "。！？；：!?;:”』）)》〉"
CONFIDENT = 0.6

CHAPTER_RE_S = r"^第[一二三四五六七八九十百零〇]+章"
ARTICLE_RE_S = r"^第[一二三四五六七八九十百零〇]+条"


# ------------------------------------------------------------------ 清洗
def is_artifact(line):
    if not line:
        return False
    if line in ARTIFACT_LINES:
        return True
    if line.isdigit() and len(line) <= 4:
        return True
    if len(line) == 8 and line[2] == ":" and line[5] == ":":
        return True
    if len(line) >= 3 and not any("\u4e00" <= c <= "\u9fff" for c in line):
        return True
    return "ANHUI UNIV" in line


def tidy(line):
    line = line.replace("\u3000", " ").replace("\xa0", " ")
    return " ".join(line.split()).strip()


def continues(prev, cur):
    """分页造成的断行与前一段合并；作者自己另起的段落不动。"""
    if len(prev) < 20 or not cur or prev[-1] in SENTENCE_END:
        return False
    if cur.startswith(("(", "（", "①", "②", "③")):
        return False
    return not HEADING_RE.match(cur)


def load_body(raw_path):
    items = []
    for raw in raw_path.read_text(encoding="utf-8").split("\n"):
        line = tidy(raw)
        if not line or is_artifact(line):
            continue
        if items and items[-1][0] == "p" and continues(items[-1][1], line):
            items[-1] = ("p", items[-1][1] + line)
        else:
            items.append(("p", line))
    return items


# -------------------------------------------------------------- 补充内容
def read_supplement(path):
    if path.suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        items = [("p", data["title"])]
        if data.get("table"):
            items.append(("table", data["table"]))
        items += [("p", n) for n in data.get("notes", [])]
        return items
    lines = [l.strip() for l in path.read_text(encoding="utf-8").split("\n")]
    return [("p", l) for l in lines if l]


def apply_entry(items, spec):
    supp = read_supplement(ROOT / "source" / "supplements" / spec["file"])

    # 用可变对象承载补充条目，便于最后按对象身份算出它们落在正文的哪一段。
    supp = [[k, v] for k, v in supp]

    for old, new in spec.get("replace", []):
        supp = [[k, v.replace(old, new) if k == "p" else v] for k, v in supp]

    if spec.get("insert_file"):
        extra = read_supplement(ROOT / "source" / "supplements" / spec["insert_file"])
        extra = [[k, v] for k, v in extra]
        marker = spec["insert_before"]
        pos = next((i for i, (k, v) in enumerate(supp)
                    if k == "p" and v.startswith(marker)), None)
        if pos is None:
            raise SystemExit("补充内容内部找不到插入点：" + marker)
        supp = supp[:pos] + extra + supp[pos:]

    if spec.get("append"):
        index = len(items)
    else:
        anchor = spec["before"]
        index = next((i for i, (k, v) in enumerate(items)
                      if k == "p" and v.startswith(anchor)), None)
        if index is None:
            raise SystemExit("找不到插入位置：" + anchor)

    for offset, entry in enumerate(supp):
        items.insert(index + offset, entry)
    return len(supp)


def apply_supplements(items):
    path = ROOT / "source" / "supplements" / "index.json"
    specs = json.loads(path.read_text(encoding="utf-8"))
    added = 0
    for spec in specs:
        added += apply_entry(items, spec)

    # 按对象身份找出所有补充段落的位置区间（插入顺序被打乱也不会错）。
    marked = {id(entry) for entry in items if isinstance(entry, list)}
    ranges = []
    start = None
    for i, entry in enumerate(items):
        if id(entry) in marked:
            if start is None:
                start = i
        elif start is not None:
            ranges.append((start, i))
            start = None
    if start is not None:
        ranges.append((start, len(items)))
    return added, len(specs), ranges


# ------------------------------------------------------------ 目录匹配
def is_separator(ch):
    return ch.isspace() or unicodedata.category(ch)[0] in ("P", "S", "Z")


def normalize(text):
    out = []
    for ch in text:
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:
            ch = chr(code - 0xFEE0)
        elif code == 0x3000:
            ch = " "
        if is_separator(ch):
            continue
        out.append(ch.lower())
    return "".join(out)


def bigrams(text):
    counts = {}
    for i in range(len(text) - 1):
        gram = text[i:i + 2]
        counts[gram] = counts.get(gram, 0) + 1
    return counts


def match_title(norm_title, norm_para, para_grams):
    """标题覆盖率 × 长度惩罚：优先命中独立成行的标题，而不是正文里的引用。"""
    target = bigrams(norm_title)
    total = sum(target.values())
    if not total:
        return 0.0
    shared = 0
    for gram, count in target.items():
        if gram in para_grams:
            shared += min(count, para_grams[gram])
    extra = max(0, len(norm_para) - len(norm_title) - 8)
    return (shared / total) / (1.0 + extra / 12.0)


# 目录里少数条目在正文中没有独立标题（配图、被并进相邻段落或识别走样），
# 这里给出正文中可用的定位文字；少数直接给定段落号。
OVERRIDES = {
    "安徽大学校名": 8,
    "安徽大学校训": 12,
    "安徽大学校歌": 13,
    "安徽大学学位授予工作实施细则(修订)": 503,
    "安徽大学学士学位授予工作实施细则(修订)": 505,
}

TITLE_ANCHORS = {
    "安徽大学学生宿舍管理规定": "安徽大学学生公寓管理规定",
    "安徽大学学生宿舍空调使用文明公约": "安徽大学学生宿舍空调使用又明公约",
    "安徽大学本科生辅修第二专业实施细则": "辅修第二专业实施细制",
    "安徽大学学生海外交流学习管理办法": "说学管理办法",
    "安徽大学本科生国家奖学金管理实施细则(修订)": "本专科生国家类学金",
    "安徽大学本科生国家励志奖学金管理实施细则(修订)": "国家励志奖学金管理实施细则",
    "安徽大学三好学生、优秀学生干部和先进班集体评选与表彰暂行办法(修订)": "安徽大学三好学生",
    "安徽大学优秀毕业生评选和表彰办法": "优秀本科毕业生评选和表能办法",
    "安徽大学本专科学生资助管理办法(修订)": "本专科学生活动管理办法",
    "安徽大学家庭经济困难学生认定工作实施办法": "家庭经济困难学生认定工作实",
    "安徽大学本科生国家助学金管理实施细则(修订)": "国家助学金管理实施细则",
    "关于进一步加强学生心理健康教育工作的实施意见": "关于进一步加强学生心理健康教育工作的",
    "安徽大学在校大学生基本医疗保险工作管理办法(修订)": "在校大学生参加城镇居民基本",
    "安徽大学本专科学生临时困难补助实施细则(修订)": "临时困难补助实施细测",
}


def strip_suffix(title):
    """去掉标题末尾的（试行）(修订)(节选) 等后缀，便于在正文里定位。"""
    return re.sub(r"[（(][^）)]{1,6}[）)]$", "", title).strip()


def locate(norm_paras, anchors, start):
    """依次尝试：以标题开头 → 去掉后缀后以标题开头 → 段落中包含标题。

    「以标题开头」优先，因为正文里的引用（《…》出现在句中）不应算命中。
    """
    for anchor in anchors:
        for i in range(start, len(norm_paras)):
            if norm_paras[i].startswith(anchor):
                return i
    for anchor in anchors:
        for i in range(start, len(norm_paras)):
            if anchor and anchor in norm_paras[i]:
                return i
    return None


def load_toc():
    groups = []
    for line in (ROOT / "source" / "toc.txt").read_text(encoding="utf-8").split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            groups.append({"t": line.lstrip("# ").strip(), "items": []})
        else:
            groups[-1]["items"].append(line)
    return groups


def build_toc(paras, norm_paras, para_grams, supplement_ranges=(), report=False):
    def in_supplement(index):
        return any(start <= index < end for start, end in supplement_ranges)

    toc = []
    cursor = 0
    mapped = 0
    total = 0
    for group in load_toc():
        children = []
        for title in group["items"]:
            total += 1
            node = {"t": title}
            anchor = TITLE_ANCHORS.get(title, title)
            anchors = [normalize(anchor)]
            stripped = normalize(strip_suffix(anchor))
            if stripped and stripped != anchors[0]:
                anchors.append(stripped)
            index = locate(norm_paras, anchors, cursor)
            if index is None:
                # 少数文件在正文里的先后顺序与目录不一致，退回到全篇再找一次。
                index = locate(norm_paras, anchors, 0)
            if title in OVERRIDES:
                node["p"] = OVERRIDES[title]
                cursor = node["p"] + 1
                mapped += 1
                if report:
                    print(f"  ~ p{node['p']:<5} {title}")
            elif index is not None:
                node["p"] = index
                cursor = index + 1
                mapped += 1
                if report:
                    print(f"  = p{index:<5} {title[:30]:<32} {paras[index][:40]}")
            else:
                best_score, best_index = 0.0, None
                norm_title = normalize(title)
                for i in range(cursor, len(paras)):
                    score = match_title(norm_title, norm_paras[i], para_grams[i])
                    if score > best_score:
                        best_score, best_index = score, i
                    if score >= 0.72:
                        break
                if best_index is not None and best_score >= CONFIDENT:
                    node["p"] = best_index
                    cursor = best_index + 1
                    mapped += 1
                else:
                    node["q"] = title
                if report:
                    flag = "*" if "p" in node else " "
                    preview = paras[best_index][:42] if best_index is not None else ""
                    print(f" {flag}{best_score:.2f} p{best_index if best_index is not None else '-':<5}"
                          f" {title[:28]:<30} {preview}")
            children.append(node)
            if node.get("p") is not None and in_supplement(node["p"]):
                node["s"] = 1
        toc.append({"t": group["t"], "children": children})
    return toc, mapped, total


# ------------------------------------------------------------------ 主流程
def main():
    report = "--report" in sys.argv
    items = load_body(ROOT / "source" / "handbook-raw.txt")
    added, docs_added, supplement_ranges = apply_supplements(items)

    paras = [v if k == "p" else "" for k, v in items]
    tables = {str(i): v for i, (k, v) in enumerate(items) if k == "table"}
    norm_paras = [normalize(p) for p in paras]
    para_grams = [bigrams(n) for n in norm_paras]

    toc, mapped, total = build_toc(paras, norm_paras, para_grams, supplement_ranges, report)

    # 稀疏引用位置索引：文档名 / 章 / 条
    docs, chapters, articles = [], [], []
    for i, (kind, value) in enumerate(items):
        if kind != "p":
            continue
        if CHAPTER_RE.match(value):
            chapters.append([i, value])
        elif ARTICLE_RE.match(value):
            articles.append([i, value.split(" ", 1)[0][:24]])
    for group in toc:
        for node in group["children"]:
            if node.get("p") is not None:
                docs.append([node["p"], node["t"]])
    docs.sort()

    payload = {
        "meta": {
            "title": "安徽大学学生手册",
            "source": "学生手册电子版.doc",
            "builtAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "paragraphs": len(paras),
            "chars": sum(len(p) for p in paras),
            "supplements": docs_added,
            "supplementParagraphs": added,
        },
        "paras": paras,
        "tables": tables,
        "docs": docs,
        "chapters": chapters,
        "articles": articles,
        "toc": toc,
    }

    out = ROOT / "data" / "handbook.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        "window.HANDBOOK = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"正文 {len(paras)} 段 / {payload['meta']['chars']} 字，补充 {docs_added} 份 {added} 段，"
          f"目录 {mapped}/{total} 已定位，表格 {len(tables)} 张")
    print("写入 " + str(out))


if __name__ == "__main__":
    main()
