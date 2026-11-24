// scripts/migrate-sign-deadline.mjs - backfill signDeadline from the legacy expiresAt.
// Dry run by default. It never rewrites an already-sent deadline: changing
// what a signer was given is a business decision, so those rows are reported.
import fs from "node:fs";
import path from "node:path";
import { resolveDataSource } from "../src/lib/dataSource.js";

const APPLY = process.argv.includes("--apply");
const THIRTY_DAYS = 30 * 86400000;

function readLocalSigners() {
  const dir = process.env.LOCAL_DATA_DIR
    ? path.resolve(process.env.LOCAL_DATA_DIR)
    : path.join(process.cwd(), "src", "data", "collections");
  const file = path.join(dir, "AgreementSigner.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

function readLocal() {
  const dir = process.env.LOCAL_DATA_DIR
    ? path.resolve(process.env.LOCAL_DATA_DIR)
    : path.join(process.cwd(), "src", "data", "collections");
  const file = path.join(dir, "Agreement.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

async function readMongoSigners(url) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(url);
  await client.connect();
  const rows = await client.db(process.env.MONGODB_DB || undefined).collection("AgreementSigner").find({}).toArray();
  await client.close();
  return rows;
}

async function readMongo(url) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || undefined);
  const rows = await db.collection("Agreement").find({}).toArray();
  return { rows, close: () => client.close() };
}

const source = resolveDataSource();
let signers = [];
let rows;
let close = async () => {};
if (source.resolved === "mongo") {
  const r = await readMongo(process.env.MONGODB_URL);
  rows = r.rows;
  signers = await readMongoSigners(process.env.MONGODB_URL);
  close = r.close;
} else {
  rows = readLocal();
  signers = readLocalSigners();
}

const now = Date.now();
const backfill = [];
const flagged = [];
for (const a of rows) {
  const deadline = a.signDeadline || a.expiresAt;
  if (!a.signDeadline && a.expiresAt) backfill.push(a);
  if (a.status === "SENT" && deadline && new Date(deadline).getTime() > now + THIRTY_DAYS) {
    flagged.push({ number: a.number, deadline: new Date(deadline).toISOString() });
  }
}

const groups = { missing: 0, v1: 0, v2: 0, other: 0 };
for (const a of rows) {
  if (a.hashV == null) groups.missing += 1;
  else if (a.hashV === 1) groups.v1 += 1;
  else if (a.hashV === 2) groups.v2 += 1;
  else groups.other += 1;
}
const signedAgreements = new Set(signers.filter((s) => s.signedAt).map((s) => String(s.agreementId)));
const legacySigned = rows.filter((a) => a.hashV == null && signedAgreements.has(String(a._id))).length;
const sentRows = rows.filter((a) => a.status === "SENT");
const missingSentAt = sentRows.filter((a) => !a.sentAt).length;
const missingBothDeadlines = sentRows.filter((a) => !a.signDeadline && !a.expiresAt).length;
const deadlines = sentRows
  .map((a) => a.signDeadline ?? a.expiresAt)
  .filter(Boolean)
  .map((d) => new Date(d).getTime())
  .filter((n) => Number.isFinite(n));
const maxDeadline = deadlines.length ? new Date(Math.max(...deadlines)).toISOString() : null;

console.log("[migrate] data source: " + source.resolved);
console.log("[migrate] agreements: " + rows.length);
console.log("[migrate] need signDeadline backfill: " + backfill.length);
console.log("[migrate] hashV groups: missing=" + groups.missing + " v1=" + groups.v1 + " v2=" + groups.v2 + " other=" + groups.other);
console.log("[migrate] legacy (no hashV) with signatures: " + legacySigned);
console.log("[migrate] max SENT deadline (v2 window candidate): " + (maxDeadline || "none"));
console.log("[migrate] SENT missing sentAt (extension refused): " + missingSentAt);
console.log("[migrate] SENT missing both signDeadline and expiresAt: " + missingBothDeadlines);
console.log("[migrate] SENT beyond the 30-day cap (not modified): " + flagged.length);
for (const f of flagged.slice(0, 20)) console.log("  - " + f.number + "  " + f.deadline);

if (!APPLY) {
  console.log("[migrate] dry run. Re-run with --apply to write signDeadline + hashV=1.");
  await close();
  process.exit(0);
}

if (!backfill.length) { console.log("[migrate] nothing to do."); await close(); process.exit(0); }

if (source.resolved === "mongo") {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(process.env.MONGODB_URL);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || undefined).collection("Agreement");
  for (const a of backfill) {
    await col.updateOne({ _id: a._id }, { $set: { signDeadline: a.expiresAt, hashV: a.hashV ?? 1 } });
  }
  await client.close();
} else {
  const dir = process.env.LOCAL_DATA_DIR
    ? path.resolve(process.env.LOCAL_DATA_DIR)
    : path.join(process.cwd(), "src", "data", "collections");
  const file = path.join(dir, "Agreement.json");
  const byId = new Map(backfill.map((a) => [String(a._id), a]));
  const updated = rows.map((a) => (byId.has(String(a._id)) ? { ...a, signDeadline: a.expiresAt, hashV: a.hashV ?? 1 } : a));
  fs.writeFileSync(file, JSON.stringify(updated, null, 2), "utf8");
}
console.log("[migrate] wrote " + backfill.length + " row(s).");
await close();
