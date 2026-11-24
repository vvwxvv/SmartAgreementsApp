// scripts/realign-counter.mjs - set Counter to at least the highest issued number.
// Needed after a rollback window: old code issues numbers by count and never
// updates Counter, so rolling forward again would collide on number_unique.
import fs from "node:fs";
import path from "node:path";
import { resolveDataSource } from "../src/lib/dataSource.js";

const APPLY = process.argv.includes("--apply");
const source = resolveDataSource();
let agreements = [];
if (source.resolved === "mongo") {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(process.env.MONGODB_URL);
  await client.connect();
  agreements = await client.db(process.env.MONGODB_DB || undefined).collection("Agreement").find({}).toArray();
  await client.close();
} else {
  const dir = process.env.LOCAL_DATA_DIR
    ? path.resolve(process.env.LOCAL_DATA_DIR)
    : path.join(process.cwd(), "src", "data", "collections");
  const f = path.join(dir, "Agreement.json");
  agreements = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
}

const maxByYear = new Map();
for (const a of agreements) {
  const m = /^AGR-(\d{4})-(\d{4,})$/.exec(String(a.number || ""));
  if (!m) continue;
  const year = m[1];
  const seq = Number(m[2]);
  maxByYear.set(year, Math.max(maxByYear.get(year) || 0, seq));
}

if (!maxByYear.size) { console.log("[counter] no numbered agreements found."); process.exit(0); }
console.log("[counter] highest by year: " + JSON.stringify(Object.fromEntries(maxByYear)));
if (!APPLY) { console.log("[counter] dry run. Re-run with --apply."); process.exit(0); }

if (source.resolved === "mongo") {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(process.env.MONGODB_URL);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || undefined).collection("Counter");
  for (const [year, seq] of maxByYear) {
    await col.updateOne({ _id: "AGR-" + year }, { $max: { seq } }, { upsert: true });
  }
  await client.close();
} else {
  const dir = process.env.LOCAL_DATA_DIR
    ? path.resolve(process.env.LOCAL_DATA_DIR)
    : path.join(process.cwd(), "src", "data", "collections");
  const file = path.join(dir, "Counter.json");
  const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  for (const [year, seq] of maxByYear) {
    const key = "AGR-" + year;
    const cur = rows.find((r) => String(r._id) === key);
    if (!cur) rows.push({ _id: key, seq });
    else cur.seq = Math.max(Number(cur.seq) || 0, seq);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
}
console.log("[counter] realigned.");
