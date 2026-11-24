import json
import re
import sys
import zipfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

src = r"C:\Users\Wang Xin\.openclaw\media\inbound\学生优惠网站制作与维护服务协议---dc0d8239-3a95-4cf1-9738-edf54cc70446.docx"
out = r"D:\ClientsWebsites\AgreementApp\docs\samples\网站制作与维护服务协议.md"

z = zipfile.ZipFile(src)
xml = z.read("word/document.xml").decode("utf-8")
paras = re.findall(r"<w:p[ >].*?</w:p>", xml, re.S)
lines = []
for p in paras:
    texts = re.findall(r"<w:t[^>]*>(.*?)</w:t>", p, re.S)
    line = "".join(texts)
    line = re.sub(r"<[^>]+>", "", line).strip()
    if line:
        lines.append(line)

md = []
for i, line in enumerate(lines):
    if i == 0:
        md.append("# " + line)
        md.append("")
    elif re.match(r"^[一二三四五六七八九十]+、", line):
        md.append("")
        md.append("## " + line)
        md.append("")
    elif line in ("甲方（委托方）", "乙方（服务方）", "甲方（委托方）信息", "乙方（服务方）信息"):
        md.append("**" + line + "**")
        md.append("")
    elif re.match(r"^\d+\.\d+", line):
        md.append(line)
        md.append("")
    else:
        md.append(line)

text = "\n".join(md).strip() + "\n"
import os
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    f.write(text)

print(json.dumps({
    "out": out,
    "paragraphs": len(lines),
    "chars": len(text),
    "tail": lines[-14:]
}, ensure_ascii=False, indent=1))
