#!/usr/bin/env node
/**
 * src/data/collections/*.json → Mongo (upsert by _id).
 * Use when you go back to DATA_SOURCE=mongo and want the local edits merged in.
 *
 *   node scripts/import-from-local.mjs
 */
import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const COLLECTIONS = ["Agreement", "AgreementSigner", "SigningEvent", "AdminGate"];
const dir = path.join(process.cwd(), "src", "data", "collections");

const client = new MongoClient(process.env.MONGODB_URL || "mongodb://127.0.0.1:27017/agreement_dev");
await client.connect();
const db = client.db(process.env.MONGODB_DB || "agreement_dev");

for (const name of COLLECTIONS) {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) continue;
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!rows.length) {
    console.log(`${name}: 0 (skipped)`);
    continue;
  }
  const ops = rows.map((r) => ({ replaceOne: { filter: { _id: r._id }, replacement: r, upsert: true } }));
  const res = await db.collection(name).bulkWrite(ops, { ordered: false });
  console.log(`${name}: ${res.upsertedCount} inserted, ${res.modifiedCount} updated`);
}
await client.close();
