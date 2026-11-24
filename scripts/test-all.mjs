// scripts/test-all.mjs - run every tests/*.test.mjs without hand-maintaining a list.
// Mongo-backed tests (*-mongo.test.mjs) run only with TEST_MONGO=1; they start mongod.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = "tests";
const includeMongo = process.env.TEST_MONGO === "1";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => includeMongo || !f.endsWith("-mongo.test.mjs"))
  .map((f) => path.join(dir, f))
  .sort();

console.log("[test] files=" + files.length + (includeMongo ? " (including mongo)" : " (mongo skipped; set TEST_MONGO=1)"));
let mongo = null;
const childEnv = { ...process.env };

if (includeMongo) {
  // regression.test.mjs requires an explicit test database when TEST_MONGO=1.
  // Accept a caller-provided URL, otherwise start a throwaway memory server.
  if (!childEnv.TEST_MONGODB_URL || !childEnv.TEST_MONGODB_DB) {
    const { MongoMemoryReplSet } = await import("mongodb-memory-server");
    // Prisma's MongoDB connector needs a replica set; keep the major version in
    // step with production (override with MONGOMS_VERSION).
    mongo = await MongoMemoryReplSet.create({
      binary: { version: process.env.MONGOMS_VERSION || "7.0.24" },
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    childEnv.TEST_MONGODB_URL = mongo.getUri().replace(/\/$/, "");
    childEnv.TEST_MONGODB_DB = "agreement_test";
    console.log("[test] memory mongod at " + childEnv.TEST_MONGODB_URL);
  }
}

const res = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit", env: childEnv });
if (mongo) await mongo.stop();
process.exit(res.status ?? 1);
