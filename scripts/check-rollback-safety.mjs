// scripts/check-rollback-safety.mjs - what actually breaks if we roll back.
//
// Verification is evidence-based: verifySignature uses the signer.contentHash
// stored at signing time and checks the evidence hash. Old code does that the
// same way, so SIGNED v2 contracts still verify after a rollback.
//
// What old code cannot do is SIGN an unsigned SENT v2 contract: signAgreement
// recomputes the v1 fingerprint (including expiresAt) and compares it with
// agreement.contentHash, which is a v2 hash. So the gate flags exactly those.
import fs from "node:fs";
import path from "node:path";
import { resolveDataSource } from "../src/lib/dataSource.js";

const source = resolveDataSource();
let agreements = [];
let signers = [];

if (source.resolved === "mongo") {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(process.env.MONGODB_URL);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || undefined);
  agreements = await db.collection("Agreement").find({}).toArray();
  signers = await db.collection("AgreementSigner").find({}).toArray();
  await client.close();
} else {
  const dir = process.env.LOCAL_DATA_DIR
    ? path.resolve(process.env.LOCAL_DATA_DIR)
    : path.join(process.cwd(), "src", "data", "collections");
  const read = (n) => {
    const f = path.join(dir, n + ".json");
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
  };
  agreements = read("Agreement");
  signers = read("AgreementSigner");
}

const signedCount = new Map();
const totalCount = new Map();
for (const s of signers) {
  const key = String(s.agreementId);
  totalCount.set(key, (totalCount.get(key) || 0) + 1);
  if (s.signedAt) signedCount.set(key, (signedCount.get(key) || 0) + 1);
}
const v2 = agreements.filter((a) => a.hashV === 2);
// Any SENT v2 contract with a signer still pending cannot be completed by old
// code: the next signature recomputes a v1 hash and fails the content check.
const pendingSigners = (a) => (totalCount.get(String(a._id)) || 0) - (signedCount.get(String(a._id)) || 0) > 0;
// Status names are not a whitelist: anything not COMPLETED/VOIDED can still be
// signed (or sent) by old code, which would write a v1 hash while hashV stays 2.
const blocked = v2.filter((a) => {
  if (a.status === "COMPLETED" || a.status === "VOIDED") return false;
  if (a.status === "DRAFT") return true;
  return pendingSigners(a);
});
const drafts = v2.filter((a) => a.status === "DRAFT");

console.log("[rollback] v2 agreements: " + v2.length);
console.log("[rollback] DRAFT v2 (safe: old code re-hashes them v1 at send): " + drafts.length);

if (!blocked.length) {
  console.log("[rollback] safe: no unsigned SENT v2 contract would be stuck.");
  process.exit(0);
}

console.error("[rollback] UNSAFE: " + blocked.length + " v2 contract(s) are DRAFT or still waiting for signatures.");
for (const a of blocked.slice(0, 10)) console.error("  - " + (a.number || String(a._id)));
console.error("[rollback] Old code cannot sign these (v1 content check fails).");
console.error("[rollback] Either send them first, or roll back to a build that carries the v2 verifier.");
process.exit(1);
