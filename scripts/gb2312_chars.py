import json
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

chars = set()
for b1 in range(0xA1, 0xF8):
    for b2 in range(0xA1, 0xFF):
        try:
            chars.add(bytes([b1, b2]).decode("gb2312"))
        except Exception:
            pass
print("".join(sorted(chars)))
