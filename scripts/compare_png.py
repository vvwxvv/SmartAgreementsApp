import json
import sys

from PIL import Image, ImageChops

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

a_path, b_path = sys.argv[1], sys.argv[2]
tol = float(sys.argv[3]) if len(sys.argv) > 3 else 0.002
max_mean = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0

a = Image.open(a_path).convert("RGB")
b = Image.open(b_path).convert("RGB")
if a.size != b.size:
    print(json.dumps({"ok": False, "reason": "size", "a": a.size, "b": b.size}))
    sys.exit(0)

diff = ImageChops.difference(a, b).convert("L")
hist = diff.histogram()
total = float(sum(hist))
changed = float(sum(hist[16:]))
mean = sum(i * c for i, c in enumerate(hist)) / total if total else 0.0
ratio = changed / total if total else 0.0
print(json.dumps({
    "ok": ratio <= tol and mean <= max_mean,
    "changedRatio": round(ratio, 6),
    "meanDiff": round(mean, 4),
    "tolerance": tol,
    "maxMean": max_mean,
    "size": a.size,
}))
