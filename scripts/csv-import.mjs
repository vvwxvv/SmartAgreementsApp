#!/usr/bin/env node
/**
 * data/csv/*.csv → 本地数据目录（JSON 集合），严格按 prisma/schema.prisma 校验。
 *
 *   node scripts/csv-import.mjs --check                只校验，不写盘
 *   node scripts/csv-import.mjs --dir data/csv          导入（默认目录）
 *   node scripts/csv-import.mjs --data-dir /tmp/x       指定本地数据目录
 *   node scripts/csv-import.mjs --force                 覆盖已存在的非空集合
 *
 * 校验内容：
 *   1. 文件名必须是 schema 里的 model；
 *   2. 表头必须 ∈ model 字段，必填字段不能为空；
 *   3. Int / Boolean / DateTime(ISO) / Json 类型逐格校验；
 *   4. @db.ObjectId 字段必须是 24 位十六进制；
 *   5. 跨表引用：Signer/Event 的 agreementId、Event 的 signerId、parties.contactId。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../src/lib/csv.js";
import { parsePrismaSchema, validateRow, rowToDoc, objectIdLike } from "../src/lib/prismaSchema.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const dir = path.resolve(ROOT, String(arg("dir", "data/csv")));
const checkOnly = Boolean(arg("check", false));
const force = Boolean(arg("force", false));
const dataDir = path.resolve(String(arg("data-dir", process.env.LOCAL_DATA_DIR || path.join(ROOT, "src", "data", "collections"))));


const schemaText = await fsp.readFile(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
const models = parsePrismaSchema(schemaText);

const files = (await fsp.readdir(dir)).filter((f) => f.endsWith(".csv")).sort();
if (!files.length) {
  console.error(`没有找到 CSV：${dir}`);
  process.exit(2);
}

const errors = [];
const data = {}; // modelName -> docs

for (const file of files) {
  const modelName = path.basename(file, ".csv");
  const model = models[modelName];
  if (!model) {
    errors.push(`${file}：schema.prisma 里没有 model "${modelName}"`);
    continue;
  }
  const { headers, rows } = parseCsv(await fsp.readFile(path.join(dir, file), "utf8"));
  rows.forEach((row, i) => errors.push(...validateRow(model, row, { line: i + 2 })));

  const seen = new Set();
  const docs = [];
  rows.forEach((row, i) => {
    const doc = rowToDoc(model, row, { newId: objectIdLike });
    if (doc._id) {
      if (seen.has(doc._id)) errors.push(`${file} 第 ${i + 2} 行：id 重复 ${doc._id}`);
      seen.add(doc._id);
    }
    docs.push(doc);
  });
  data[modelName] = docs;
  console.log(`  ${file}: ${rows.length} 行 · ${headers.length} 列`);
}

// ── 跨表引用 ──────────────────────────────────────────────────────────────
const ids = (name) => new Set((data[name] || []).map((d) => d._id));
const agreements = ids("Agreement");
const parties = ids("PartyInfo");
const signers = ids("AgreementSigner");

for (const [i, s] of (data.AgreementSigner || []).entries()) {
  if (s.agreementId && !agreements.has(s.agreementId)) {
    errors.push(`AgreementSigner 第 ${i + 2} 行：agreementId ${s.agreementId} 在 Agreement.csv 中不存在`);
  }
}
for (const [i, e] of (data.SigningEvent || []).entries()) {
  if (e.agreementId && !agreements.has(e.agreementId)) {
    errors.push(`SigningEvent 第 ${i + 2} 行：agreementId ${e.agreementId} 不存在`);
  }
  if (e.signerId && !signers.has(e.signerId)) {
    errors.push(`SigningEvent 第 ${i + 2} 行：signerId ${e.signerId} 不存在`);
  }
}
for (const [i, a] of (data.Agreement || []).entries()) {
  const list = Array.isArray(a.parties) ? a.parties : [];
  for (const p of list) {
    if (p?.contactId && !parties.has(p.contactId)) {
      errors.push(`Agreement 第 ${i + 2} 行：parties.contactId ${p.contactId} 在 PartyInfo.csv 中不存在`);
    }
  }
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} 个问题：`);
  for (const e of errors.slice(0, 50)) console.error("  - " + e);
  if (errors.length > 50) console.error(`  … 其余 ${errors.length - 50} 条省略`);
  process.exit(1);
}
console.log(`\n✓ 全部通过：${Object.keys(data).length} 个 model，${Object.values(data).reduce((n, d) => n + d.length, 0)} 行`);

if (checkOnly) process.exit(0);

// 生产环境防手滑：即使目标集合为空，也必须显式 --force 才写入示例数据。
if (String(process.env.NODE_ENV || "").toLowerCase() === "production" && !force) {
  console.error("✗ 生产环境（NODE_ENV=production）导入示例数据必须加 --force");
  process.exit(4);
}

// ── 写盘 ──────────────────────────────────────────────────────────────────
await fsp.mkdir(dataDir, { recursive: true });
for (const [modelName, docs] of Object.entries(data)) {
  const target = path.join(dataDir, `${modelName}.json`);
  if (fs.existsSync(target) && !force) {
    const prev = await fsp.readFile(target, "utf8").catch(() => "[]");
    let count = 0;
    try { count = JSON.parse(prev).length; } catch { count = 0; }
    if (count > 0) {
      console.error(`✗ ${target} 已有 ${count} 条记录；确认要覆盖请加 --force`);
      process.exit(3);
    }
  }
  await fsp.writeFile(target, JSON.stringify(docs, null, 2) + "\n");
  console.log(`  → ${target} (${docs.length})`);
}
// 种子清单：记录这次导入了哪些文档，供「清空示例数据」精确删除。
const manifest = {
  seededAt: new Date().toISOString(),
  source: path.relative(ROOT, dir) || "data/csv",
  models: Object.fromEntries(Object.entries(data).map(([name, docs]) => [name, docs.map((d) => d._id).filter(Boolean)])),
  files: files,
};
await fsp.writeFile(path.join(dataDir, ".csv-seed.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n完成。数据目录：${dataDir}（已写 .csv-seed.json）`);
