// scripts/scan-build-secrets.mjs - prove build output contains no server secrets.
// Reads .env locally, scans .next/static (and .next/server if present), and
// prints COUNTS ONLY. Never echoes a value.
import fs from "node:fs";
import path from "node:path";

const SECRET_KEYS = ["JWT_SECRET", "ADMIN_SESSION_SECRET", "PATTERN_UNLOCK_PASSWORD", "AGREEMENT_INTEGRATION_SECRET", "MONGODB_URL"];

function readEnv() {
  const out = {};
  if (!fs.existsSync(".env")) return out;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function variants(value) {
  if (!value) return [];
  const set = new Set([value]);
  set.add(JSON.stringify(value).slice(1, -1));
  if (/^[0-9,\s]+$/.test(value)) {
    const nums = value.split(",").map((s) => s.trim()).filter(Boolean);
    set.add(nums.join(""));
    set.add(nums.join(","));
    set.add(nums.join(", "));
    set.add("[" + nums.join(",") + "]");
    set.add("[" + nums.join(", ") + "]");
  }
  return [...set].filter((v) => v.length >= 6);
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

const env = readEnv();
const targets = ["...next/static".replace("...", "."), path.join(".next", "server")];
const files = targets.flatMap((d) => walk(d, []));
if (!files.length) {
  console.log("no build output found (run npm run build first)");
  process.exit(0);
}

let total = 0;
for (const key of SECRET_KEYS) {
  const value = env[key];
  if (!value) { console.log(key + ": not set (skipped)"); continue; }
  const needles = variants(value);
  let hits = 0;
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const needle of needles) {
      const idx = text.indexOf(needle);
      if (idx !== -1) { hits += 1; break; }
    }
  }
  console.log(key + ": hits=" + hits + " variants=" + needles.length);
  total += hits;
}
console.log("files_scanned=" + files.length);
console.log("TOTAL_HITS=" + total);
process.exit(total === 0 ? 0 : 1);
