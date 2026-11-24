#!/usr/bin/env python3
"""Convert a DOCX to Markdown for the agreement print pipeline.

- headings before bold (so "## 一、..." is not swallowed by **...**)
- bold spans never start/end with whitespace or punctuation (CommonMark flanking)
- fully-bold short labels become ### subheadings
- tables become GFM tables
"""
import json
import re
import sys
import unicodedata

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph


def iter_blocks(document):
    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield Table(child, document)


def edge_trim(text, bold):
    if not bold:
        return text
    lead = ""
    trail = ""
    s = text
    while s and (s[0].isspace() or unicodedata.category(s[0])[0] in "PS"):
        lead += s[0]
        s = s[1:]
    while s and (s[-1].isspace() or unicodedata.category(s[-1])[0] in "PS"):
        trail = s[-1] + trail
        s = s[:-1]
    if not s:
        return lead + trail
    return lead + "**" + s + "**" + trail


def paragraph_markdown(p, first=False):
    runs = [r for r in p.runs if r.text]
    plain = "".join(r.text for r in runs).strip()
    if not plain:
        return ""
    if first:
        return "# " + plain
    style = (p.style.name or "").lower()
    if re.match(r"^[一二三四五六七八九十]+、", plain) or style.startswith("heading"):
        return "## " + plain
    fully_bold = bool(runs) and all(bool(r.bold) for r in runs if r.text.strip())
    if fully_bold and len(plain) <= 30 and not re.search(r"[。；：！？]$", plain):
        return "### " + plain

    chunks = []
    buf = ""
    bold = None
    for run in runs:
        b = bool(run.bold)
        if bold is None:
            bold = b
            buf = run.text
        elif b == bold:
            buf += run.text
        else:
            chunks.append(edge_trim(buf, bold))
            buf = run.text
            bold = b
    if buf:
        chunks.append(edge_trim(buf, bold))
    return "".join(chunks).strip()


def table_markdown(table):
    rows = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            value = cell.text.replace("\n", " ").replace("|", "\\|").strip()
            cells.append(value)
        rows.append(cells)
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    out = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    for r in rows[1:]:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    doc = Document(src)
    blocks = list(iter_blocks(doc))
    md = []
    tables = 0
    first_text = True
    for block in blocks:
        if isinstance(block, Table):
            t = table_markdown(block)
            if t:
                md.append("")
                md.append(t)
                md.append("")
                tables += 1
            continue
        text = paragraph_markdown(block, first=first_text)
        if not text:
            continue
        first_text = False
        md.append(text)
        md.append("")

    out = "\n".join(md).strip() + "\n"
    with open(dst, "w", encoding="utf-8") as f:
        f.write(out)
    print(json.dumps({
        "out": dst,
        "paragraphs": sum(1 for b in blocks if isinstance(b, Paragraph)),
        "tables": tables,
        "chars": len(out),
        "h2": len(re.findall(r"^## ", out, re.M)),
        "h3": len(re.findall(r"^### ", out, re.M)),
        "literalDoubleStar": out.count("**"),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
