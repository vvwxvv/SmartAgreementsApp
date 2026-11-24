// scripts/export-local.mjs - local collections -> Prisma-ready JSON (+ CSV).
import fs from "node:fs";
import path from "node:path";
import { loadModels, toPrismaDoc } from "./lib/localToPrisma.mjs";

const args = process.argv.slice(2);
const outDir = (args.find((a) => a.startsWith("--out=")) || "--out=export").split("=")[1];
const only = (args.find((a) => a.startsWith("--collection=")) || "").split("=")[1];
const noCsv = args.includes("--no-csv");
const src = process.env.LOCAL_DATA_DIR
  ? path.resolve(process.env.LOCAL_DATA_DIR)
  : path.join(process.cwd(), "src", "data", "collections");

const models = loadModels();
fs.mkdirSync(outDir, { recursive: true });
const QUOTE = String.fromCharCode(34);

function csvCell(v) {
  if (v === undefined || v === null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  const needs = s.indexOf(",") !== -1 || s.indexOf(QUOTE) !== -1 || s.indexOf("\n") !== -1 || s.indexOf("\r") !== -1;
  if (!needs) return s;
  return QUOTE + s.split(QUOTE).join(QUOTE + QUOTE) + QUOTE;
}
function toCsv(model, docs) {
  const cols = model.fields.map((f) => f.name);
  const rows = [cols.join(",")];
  for (const d of docs) rows.push(cols.map((c) => csvCell(d[c])).join(","));
  return rows.join("\r\n") + "\r\n";
}

const report = {};
let total = 0;
let failed = 0;
for (const [name, model] of Object.entries(models)) {
  if (only && name !== only) continue;
  const file = path.join(src, name + ".json");
  if (!fs.existsSync(file)) continue;
  const docs = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [];
  const bad = [];
  for (const doc of docs) {
    const m = toPrismaDoc(model, doc);
    if (m.errors.length) bad.push({ id: String(doc._id || doc.id || "?"), errors: m.errors });
    else out.push(m.value);
  }
  if (bad.length) {
    failed += bad.length;
    console.error("[export] " + name + ": " + bad.length + " invalid doc(s)");
    console.error(JSON.stringify(bad.slice(0, 3), null, 2));
    continue;
  }
  fs.writeFileSync(path.join(outDir, name + ".json"), JSON.stringify(out, null, 2));
  if (!noCsv) fs.writeFileSync(path.join(outDir, name + ".csv"), toCsv(model, out));
  report[name] = out.length;
  total += out.length;
  console.log("[export] " + name + ": " + out.length);
}

fs.writeFileSync(path.join(outDir, "_report.json"), JSON.stringify({ source: src, total, report, at: new Date().toISOString() }, null, 2));
console.log("[export] total=" + total + " failed=" + failed + " -> " + outDir);
if (failed) process.exitCode = 1;
