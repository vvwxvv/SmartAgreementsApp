import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pymupdf

pdf_path, out_dir, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
doc = pymupdf.open(pdf_path)
os.makedirs(out_dir, exist_ok=True)
files = []
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=144)
    out = os.path.join(out_dir, prefix + "-p" + str(i + 1) + ".png")
    pix.save(out)
    files.append(out)
print(json.dumps({"pages": len(doc), "files": files}, ensure_ascii=False))
