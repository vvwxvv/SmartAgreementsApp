// scripts/check-indexes.mjs - refuse to start when the unique index is missing.
import { resolveDataSource } from "../src/lib/dataSource.js";

const source = resolveDataSource();
if (source.resolved !== "mongo") {
  console.log("[check-indexes] data source is " + source.resolved + "; nothing to check.");
  process.exit(0);
}

const { MongoClient } = await import("mongodb");
const client = new MongoClient(process.env.MONGODB_URL);
try {
  await client.connect();
  const indexes = await client.db(process.env.MONGODB_DB || undefined).collection("Agreement").indexes();
  if (!indexes.some((i) => i.name === "number_unique")) {
    console.error("[check-indexes] missing unique index number_unique on Agreement. Run: npm run db:indexes");
    process.exitCode = 1;
  } else {
    console.log("[check-indexes] number_unique present.");
  }
} catch (e) {
  console.error("[check-indexes] could not verify indexes: " + (e && e.message));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
