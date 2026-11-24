#!/usr/bin/env node
/**
 * Production index creation. Explicit opt-in:
 *   MONGODB_URL=... MONGODB_DB=... node scripts/init-indexes-prod.mjs
 *   MONGODB_URL=... MONGODB_DB=... node scripts/init-indexes-prod.mjs --apply --confirm=<dbName>
 *
 * Dry run by default. Never prints the URL (it can contain credentials).
 * The test-only init-indexes.mjs remains separate so tests cannot point here.
 */
import { MongoClient } from "mongodb";
import { INDEX_SPEC } from "./lib/indexSpec.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirm = (args.find((a) => a.startsWith("--confirm=")) || "").slice("--confirm=".length);
const url = process.env.MONGODB_URL || "";
const dbName = process.env.MONGODB_DB || "";

function fail(message) {
  console.error("[indexes] " + message);
  process.exit(2);
}

if (!url) fail("MONGODB_URL is required");
if (!dbName) fail("MONGODB_DB is required");
if (process.env.DATA_SOURCE === "local") fail("DATA_SOURCE=local; refusing to touch indexes");
let host = "";
try { host = new URL(url).host; } catch { fail("MONGODB_URL is not a valid URL"); }

if (!apply) {
  console.log("[indexes] target " + host + " / " + dbName);
  for (const spec of INDEX_SPEC) {
    console.log("  " + spec.collection + " " + JSON.stringify(spec.keys) + (spec.options.unique ? " unique" : "") + " -> " + spec.options.name);
  }
  console.log("[indexes] dry run. Re-run with --apply --confirm=" + dbName);
  process.exit(0);
}
if (confirm !== dbName) fail("pass --confirm=" + dbName + " to apply");

const client = new MongoClient(url);
await client.connect();
try {
  const db = client.db(dbName);
  console.log("[indexes] target " + host + " / " + dbName);
  for (const spec of INDEX_SPEC) {
    await db.collection(spec.collection).createIndex(spec.keys, spec.options);
    console.log("[indexes] ensured " + spec.options.name);
  }

  const missing = [];
  for (const spec of INDEX_SPEC.filter((s) => s.options.unique)) {
    const names = (await db.collection(spec.collection).indexes()).map((i) => i.name);
    if (!names.includes(spec.options.name)) missing.push(spec.options.name);
  }
  if (missing.length) {
    console.error("[indexes] missing after apply: " + missing.join(", "));
    process.exitCode = 1;
  } else {
    console.log("[indexes] all unique indexes present on " + dbName);
  }
} finally {
  await client.close().catch(() => {});
}
