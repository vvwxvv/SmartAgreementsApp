import json
import re
import sys
import zipfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

path = r"C:\Users\Wang Xin\.openclaw\media\inbound\学生优惠网站制作与维护服务协议---dc0d8239-3a95-4cf1-9738-edf54cc70446.docx"
z = zipfile.ZipFile(path)
xml = z.read("word/document.xml").decode("utf-8")

paras = re.findall(r"<w:p[ >].*?</w:p>", xml, re.S)
lines = []
for p in paras:
    texts = re.findall(r"<w:t[^>]*>(.*?)</w:t>", p, re.S)
    line = "".join(texts)
    line = re.sub(r"<[^>]+>", "", line)
    if line.strip():
        lines.append(line.strip())
print(json.dumps(lines, ensure_ascii=False, indent=1))
