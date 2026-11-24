#!/usr/bin/env node
/**
 * Upload the demo agreements used in the layout evaluation to the configured
 * MongoDB (MONGODB_URL + MONGODB_DB from .env). Additive only: it never deletes
 * or updates existing rows, and never lists databases.
 *
 *   node --env-file=.env scripts/tmp-seed-mongo-demo.mjs --check
 *   node --env-file=.env scripts/tmp-seed-mongo-demo.mjs --apply
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoClient, ObjectId } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const URI = process.env.MONGODB_URL;
const DB = process.env.MONGODB_DB;
if (!URI || !DB) {
  console.error('need MONGODB_URL + MONGODB_DB');
  process.exit(2);
}

const { createStorage } = await import('../packages/agreement/src/core/index.js');
const { createAgreementService } = await import('../packages/agreement/src/core/index.js');

const client = new MongoClient(URI, { maxPoolSize: 4, retryWrites: true });
await client.connect();
const db = client.db(DB);

// Read-only preflight: counts for this database only (no listDatabases).
const counts = {};
for (const name of ['Agreement', 'AgreementSigner', 'PartyInfo', 'SigningEvent']) {
  counts[name] = await db.collection(name).countDocuments();
}
console.log('[mongo] db=' + DB + ' counts=' + JSON.stringify(counts));

if (!APPLY) {
  console.log('[mongo] dry run. Re-run with --apply to insert.');
  await client.close();
  process.exit(0);
}

const service = createAgreementService({
  storage: async () => createStorage(db, { ObjectId }),
  baseUrl: process.env.AGREEMENT_BASE_URL || 'http://localhost:3000',
  secrets: {
    signSecret: process.env.JWT_SECRET || '',
    linkKey: process.env.AGREEMENT_LINK_KEY || '',
    previousLinkKeys: () => String(process.env.AGREEMENT_LINK_KEYS_PREVIOUS || ''),
  },
  tsa: async () => ({ ok: false, error: 'disabled for demo' }),
});

const store = createStorage(db, { ObjectId, contacts: 'mongo' });
const now = new Date();
const party = (name, nameEn, email, isSelf) =>
  store.insertPartyInfo({
    _id: store.newId(), kind: 'company', name, nameEn, contactPerson: null,
    email, phone: null, address: null, addressEn: null, note: 'demo import',
    isSelf, archivedAt: null, createdAt: now, updatedAt: now,
  });

const a = await party('周松工作室', 'Zhou Song Studio', 'zhou@example.com', false);
const b = await party('无瑕科技有限公司', 'Flawless Dev Ltd', 'studio@flawless.example', true);

const DOCS = [
  { file: 'docs/demos/艺术家资料提交规范-原文.md', title: '艺术家网站资料提交规范（原文直贴）', category: '资料提交规范' },
  { file: 'docs/demos/艺术家资料提交规范-结构化.md', title: '艺术家网站资料提交规范（结构化改写）', category: '资料提交规范' },
  { file: 'docs/demos/排版演示-含目录.md', title: '排版规范演示 V3 · 含目录', category: '资料提交规范' },
];

const created = [];
for (const doc of DOCS) {
  const body = fs.readFileSync(doc.file, 'utf8');
  const id = await service.createDraft({
    title: doc.title,
    category: doc.category,
    body,
    partyA: String(a._id),
    partyB: String(b._id),
    consentText: '我已阅读并确认本规范全部内容，愿按此提交资料，并同意以电子方式确认。',
  }, 'demo-import');
  const sent = await service.sendAgreement(id, {});
  const status = await service.getStatus(id);
  created.push({
    id: String(id),
    number: status.number,
    title: doc.title,
    signUrl: sent.links[0]?.url || null,
  });
  console.log('[mongo] created ' + status.number + ' · ' + doc.title);
}

fs.writeFileSync('/tmp/mongo-demo-result.json', JSON.stringify(created, null, 2));
console.log(JSON.stringify(created, null, 2));
await client.close();
