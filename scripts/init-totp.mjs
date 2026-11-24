#!/usr/bin/env node
/**
 * scripts/init-totp.mjs — enrol an authenticator app as the admin second factor.
 *
 *   npm run init:totp                          # local JSON store
 *   npm run init:totp -- --mongo               # production MongoDB
 *   npm run init:totp -- --force --account=me  # rotate an existing secret
 *
 * Prints the base32 secret and an otpauth:// URL. The secret is stored sealed
 * (AES-256-GCM) with a key derived from ADMIN_TOTP_KEY / ADMIN_SESSION_SECRET /
 * JWT_SECRET — a database dump alone cannot mint codes.
 *
 * Enrollment is intentionally CLI-only: no HTTP route can set or replace it.
 */
import fs from "node:fs";
import path from "node:path";
import { generateTotpSecret, totpKey, sealSecret, otpauthUrl } from "../src/lib/totp.js";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const has = (name) => args.includes("--" + name);
const argOf = (name, fallback = "") => {
  const hit = args.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const useMongo = has("mongo") || String(process.env.DATA_SOURCE || "").toLowerCase() === "mongo";
const force = has("force");
const account = argOf("account", process.env.AGREEMENT_TOTP_ACCOUNT || "admin");
const issuer = argOf("issuer", process.env.AGREEMENT_TOTP_ISSUER || "Agreement");

const sealingSecret =
  process.env.ADMIN_TOTP_KEY || process.env.ADMIN_SESSION_SECRET || process.env.JWT_SECRET || "";
if (!sealingSecret || sealingSecret.length < 16) {
  console.error("需要 ADMIN_TOTP_KEY 或 ADMIN_SESSION_SECRET/JWT_SECRET（≥16 字符）才能加密保存 TOTP 密钥。");
  process.exit(2);
}

const secret = generateTotpSecret();
const sealed = sealSecret(secret, totpKey(sealingSecret));
const now = new Date();

async function writeMongo() {
  const { MongoClient } = await import("mongodb");
  const url = process.env.MONGODB_URL;
  const dbName = process.env.MONGODB_DB;
  if (!url || !dbName) {
    console.error("--mongo 需要 MONGODB_URL 与 MONGODB_DB");
    process.exit(2);
  }
  const client = new MongoClient(url);
  await client.connect();
  const col = client.db(dbName).collection("AdminGate");
  const existing = await col.findOne({ _id: "gate" });
  if (existing?.totpSecret && !force) {
    console.error("TOTP 已启用；如确认要轮换，请加 --force（旧验证器会立即失效）");
    await client.close();
    process.exit(1);
  }
  await col.updateOne(
    { _id: "gate" },
    {
      $set: {
        totpSecret: sealed,
        totpEnabled: true,
        totpLastStep: null,
        totpUpdatedAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  await client.close();
}

function writeLocal() {
  const dir = path.resolve(process.env.LOCAL_DATA_DIR || path.join(process.cwd(), "src", "data", "collections"));
  const file = path.join(dir, "AdminGate.json");
  let rows = [];
  try {
    rows = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows)) rows = [];
  const idx = rows.findIndex((r) => r && r._id === "gate");
  if (idx >= 0 && rows[idx].totpSecret && !force) {
    console.error("TOTP 已启用；如确认要轮换，请加 --force（旧验证器会立即失效）");
    process.exit(1);
  }
  const patch = {
    totpSecret: sealed,
    totpEnabled: true,
    totpLastStep: null,
    totpUpdatedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
  else rows.push({ _id: "gate", ...patch });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2) + "\n", "utf8");
  console.log("写入：" + file);
}

if (useMongo) await writeMongo();
else writeLocal();

console.log("");
console.log("TOTP 已启用。请在验证器 App（1Password / Google Authenticator / Authy）里添加：");
console.log("");
console.log("  密钥（base32）： " + secret);
console.log("  otpauth 地址：  " + otpauthUrl({ issuer, account, secret }));
console.log("");
console.log("提示：密钥只显示这一次。丢失验证器时，用本脚本 --force 重新生成（旧码立即失效）。");
console.log("如果轮换过 ADMIN_TOTP_KEY/ADMIN_SESSION_SECRET，TOTP 将无法解密，需要重新运行本脚本。");
