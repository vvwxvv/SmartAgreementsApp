import json
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
pages = []
for page in reader.pages:
    pages.append(page.extract_text() or "")
print(json.dumps({"pages": len(reader.pages), "text": "\n".join(pages)}, ensure_ascii=False))
