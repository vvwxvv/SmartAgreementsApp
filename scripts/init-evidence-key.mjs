#!/usr/bin/env node
/**
 * Generate an Ed25519 key for server-side evidence signatures.
 *
 *   node scripts/init-evidence-key.mjs            print env lines
 *   node scripts/init-evidence-key.mjs --write     append/update .env (backup kept)
 *
 * The private key never leaves this machine; only the public half belongs in
 * backups you intend to share. Old public keys stay verifiable through
 * AGREEMENT_EVIDENCE_PUBLIC_KEYS after a rotation.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64url');
const x = publicKey.export({ format: 'jwk' }).x;
const kid = crypto.createHash('sha256').update(Buffer.from(x, 'base64url')).digest('hex').slice(0, 8);

const lines = [
  '# Ed25519 evidence signing (server-side; keep private, publish only the public half)',
  `AGREEMENT_EVIDENCE_PRIVATE_KEY=${seed}`,
  `# Current kid=${kid}; old public keys can be listed as "kid:x,kid:x" after rotation:`,
  `# AGREEMENT_EVIDENCE_PUBLIC_KEYS=`,
];

console.log(lines.join('\n'));
console.log('# Public key (kid=' + kid + ', x=' + x + ')');

if (process.argv.includes('--write')) {
  const file = path.resolve('.env');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak-' + stamp);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const kept = current
    .split(/\r?\n/)
    .filter((l) => l && !/^AGREEMENT_EVIDENCE_PRIVATE_KEY=/.test(l))
    .join('\n');
  fs.writeFileSync(file, (kept ? kept + '\n' : '') + lines[0] + '\n' + lines[1] + '\n');
  console.log('# written to ' + file + (fs.existsSync(file + '.bak-' + stamp) ? ' (backup: ' + file + '.bak-' + stamp + ')' : ''));
}
