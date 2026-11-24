#!/usr/bin/env node
/**
 * scripts/seed-sample.mjs  (npm run seed:sample)
 *
 * Resets LIVE local data to one sample contract built from
 * docs/samples/网站制作与维护服务协议.md.
 *
 * - dry-run by default; writes only with --confirm
 * - backs up outside the project first; aborts if the backup fails
 * - local mode only; never touches a database
 * - AdminGate is never modified
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const repo = process.cwd();
const confirm = process.argv.includes('--confirm');
const source = String(process.env.DATA_SOURCE || '').toLowerCase();

if (source !== 'local') {
  console.error('refusing: DATA_SOURCE must be local (got "' + source + '")');
  process.exit(2);
}

const dir = path.resolve(process.env.LOCAL_DATA_DIR || path.join(repo, 'src', 'data', 'collections'));
const repoDir = path.join(repo, 'src', 'data', 'collections');
if (dir !== repoDir && !dir.startsWith(os.tmpdir())) {
  console.error('refusing: LOCAL_DATA_DIR must be the repo collections dir or a temp dir');
  process.exit(2);
}

const samplePath = path.join(repo, 'docs', 'samples', '网站制作与维护服务协议.md');
if (!fs.existsSync(samplePath)) {
  console.error('missing sample: ' + samplePath);
  process.exit(2);
}

const files = ['Agreement', 'AgreementSigner', 'SigningEvent', 'PartyInfo', 'AdminGate'];
const counts = {};
for (const c of files) {
  const p = path.join(dir, c + '.json');
  try {
    const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
    counts[c] = Array.isArray(rows) ? rows.length : 1;
  } catch (e) {
    counts[c] = null;
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join('D:\\ClientsWebsites\\_backups\\AgreementApp', 'pre-seed-' + stamp);
const plan = {
  mode: confirm ? 'write' : 'dry-run',
  dataDir: dir,
  current: counts,
  willClear: ['Agreement', 'AgreementSigner', 'SigningEvent', 'PartyInfo'],
  untouched: ['AdminGate'],
  sample: {
    title: '网站制作与维护服务协议',
    parties: ['甲方 周松', '乙方 王欣'],
  },
  backupDir,
  resultFile: path.join(repo, 'docs', 'samples', 'seed-result.json'),
};

console.log(JSON.stringify(plan, null, 2));
if (!confirm) {
  console.log('');
  console.log('dry-run only. Re-run with --confirm to write.');
  process.exit(0);
}

// ---- backup first; abort on any failure ----
fs.mkdirSync(backupDir, { recursive: true });
for (const c of files) {
  const from = path.join(dir, c + '.json');
  if (!fs.existsSync(from)) continue;
  const to = path.join(backupDir, c + '.json');
  fs.copyFileSync(from, to);
  const a = fs.statSync(from).size;
  const b = fs.statSync(to).size;
  if (a !== b) {
    console.error('backup failed: ' + c + ' size mismatch (' + a + ' vs ' + b + ')');
    process.exit(1);
  }
}
console.log('backup ok: ' + backupDir);

for (const c of ['Agreement', 'AgreementSigner', 'SigningEvent', 'PartyInfo']) {
  fs.writeFileSync(path.join(dir, c + '.json'), '[]\n', 'utf8');
}

process.env.LOCAL_DATA_DIR = dir;
const { getLocalDb } = await import('../src/lib/localDb.js');
const { ObjectId } = await import('mongodb');
const { createStorage, createAgreementService } = await import('../packages/agreement/src/core/index.js');

const service = createAgreementService({
  storage: async () => createStorage(getLocalDb(), { ObjectId }),
  baseUrl: process.env.AGREEMENT_BASE_URL || 'http://localhost:3000',
  secrets: {
    signSecret: process.env.JWT_SECRET || process.env.AGREEMENT_SECRET || 'dev-only-secret-change-me',
    linkKey: process.env.AGREEMENT_LINK_KEY || '',
  },
  tsa: async () => ({ ok: false, error: 'disabled for local sample' }),
});

const body = fs.readFileSync(samplePath, 'utf8');

// Contacts are the source of names/emails; the template only has {{partyA.name}}.
const { createStorage: createLocalStorage } = await import('../packages/agreement/src/core/index.js');
const partyInfoStore = createLocalStorage(getLocalDb(), { ObjectId, contacts: 'local' });
const stampNow = new Date();
const partyInfoA = await partyInfoStore.insertPartyInfo({
  _id: partyInfoStore.newId(), kind: 'person', name: '周松', nameEn: null, contactPerson: null,
  email: 'zhousong@example.com', phone: null, address: null, addressEn: null, note: 'placeholder email',
  isSelf: false, archivedAt: null, createdAt: stampNow, updatedAt: stampNow,
});
const partyInfoB = await partyInfoStore.insertPartyInfo({
  _id: partyInfoStore.newId(), kind: 'person', name: '王欣', nameEn: null, contactPerson: null,
  email: 'wangxin@example.com', phone: null, address: null, addressEn: null, note: 'placeholder email; isSelf',
  isSelf: true, archivedAt: null, createdAt: stampNow, updatedAt: stampNow,
});

const id = await service.createDraft({
  title: '网站制作与维护服务协议',
  category: '服务协议',
  body,
  partyA: String(partyInfoA._id),
  partyB: String(partyInfoB._id),
  consentText: '我已阅读并同意本协议全部条款，自愿以电子方式签署，并同意系统保存本次签署记录。',
}, 'sample-seed');

const sent = await service.sendAgreement(id, {});
const status = await service.getStatus(id);
const result = {
  seededAt: new Date().toISOString(),
  id: String(id),
  number: status.number,
  status: status.status,
  contentHash: sent.contentHash,
  signers: sent.links.map((l) => ({ email: l.email, label: l.label, url: l.url })),
};
const out = path.join(repo, 'docs', 'samples', 'seed-result.json');
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ number: result.number, id: result.id, status: result.status, links: result.signers.length, out }, null, 2));
