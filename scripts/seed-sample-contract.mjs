#!/usr/bin/env node
/**
 * scripts/seed-sample-contract.mjs  (local only)
 *
 * Replaces the local business collections with ONE sample contract built from
 * docs/samples/网站制作与维护服务协议.md. Keeps AdminGate.
 * A copy of the previous files is written under D:\ClientsWebsites\_backups.
 *
 * Requires: DATA_SOURCE=local and --yes (explicit destructive action).
 * Run: node --env-file=.env scripts/seed-sample-contract.mjs --yes
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const repo = process.cwd();
const yes = process.argv.includes('--yes');
const source = String(process.env.DATA_SOURCE || '').toLowerCase();
if (source !== 'local') {
  console.error('refusing: DATA_SOURCE must be local (got "' + source + '")');
  process.exit(2);
}
if (!yes) {
  console.error('refusing: pass --yes to replace the local contract data');
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

// Safety copy next to the timestamped collection backup.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join('D:\\ClientsWebsites\\_backups\\AgreementApp', 'pre-seed-' + stamp);
if (dir === repoDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  for (const c of ['Agreement', 'AgreementSigner', 'SigningEvent', 'AdminGate']) {
    const f = path.join(dir, c + '.json');
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(backupDir, c + '.json'));
  }
  console.log('backup: ' + backupDir);
}

for (const c of ['Agreement', 'AgreementSigner', 'SigningEvent']) {
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
const id = await service.createDraft({
  title: '网站制作与维护服务协议',
  category: '服务协议',
  body,
  consentText: '我已阅读并同意本协议全部条款，自愿以电子方式签署，并同意系统保存本次签署记录。',
  signers: [
    { email: 'zhousong@example.com', label: '甲方 周松' },
    { email: 'wangxin@example.com', label: '乙方 王欣' },
  ],
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
