#!/usr/bin/env node
/**
 * Mongo → src/data/collections/*.json
 * Use before switching the app to DATA_SOURCE=local.
 *
 *   node scripts/export-to-local.mjs
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
const outDir = path.join(process.cwd(), "src", "data", "collections");
fs.mkdirSync(outDir, { recursive: true });

const client = new MongoClient(process.env.MONGODB_URL || "mongodb://127.0.0.1:27017/agreement_dev");
await client.connect();
const db = client.db(process.env.MONGODB_DB || "agreement_dev");

for (const name of COLLECTIONS) {
  const rows = await db.collection(name).find({}).toArray();
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(rows, null, 2));
  console.log(`${name}: ${rows.length}`);
}
await client.close();
console.log(`\nwritten to ${outDir}`);
