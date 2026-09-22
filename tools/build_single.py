# -*- coding: utf-8 -*-
"""把 index.html、样式、脚本和数据打包成一个可以随手转发的单文件网页。

输出 dist/学生手册查询.html：拷到手机、发给同学，双击/打开就能用，不需要服务器。
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "学生手册查询.html"


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def safe(js):
    """行内脚本里不能出现 </script。"""
    return js.replace("</script", "<\\/script")


def main():
    html = read("index.html")

    def inline(pattern, replacement, text):
        new, count = re.subn(pattern, lambda _: replacement, text)
        if count != 1:
            raise SystemExit("打包失败，未找到外部引用：" + pattern)
        return new

    html = inline(r'<link rel="stylesheet" href="assets/styles\.css[^"]*">',
                  "<style>\n" + read("assets/styles.css") + "\n</style>", html)
    html = inline(r'<script src="data/handbook\.js[^"]*"></script>',
                  "<script>\n" + safe(read("data/handbook.js")) + "\n</script>", html)
    html = inline(r'<script src="assets/app\.js[^"]*"></script>',
                  "<script>\n" + safe(read("assets/app.js")) + "\n</script>", html)

    if re.search(r'(?:src|href)="(?:assets|data)/', html):
        raise SystemExit("打包失败：仍有未内联的外部文件")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"单文件网页：{OUT}（{OUT.stat().st_size / 1024:.0f} KB）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
