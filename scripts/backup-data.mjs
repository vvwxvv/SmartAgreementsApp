#!/usr/bin/env node
/**
 * scripts/backup-data.mjs  (npm run backup:data)
 * Zips src/data/collections to D:\ClientsWebsites\_backups\AgreementApp.
 * Read-only on the data; aborts if the archive cannot be created.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const src = path.join(repo, 'src', 'data', 'collections');
if (!fs.existsSync(src)) {
  console.error('missing ' + src);
  process.exit(2);
}
const destDir = 'D:\\ClientsWebsites\\_backups\\AgreementApp';
fs.mkdirSync(destDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const zip = path.join(destDir, 'collections-' + stamp + '.zip');

const ps = spawnSync('powershell', ['-NoProfile', '-Command',
  "Compress-Archive -Path '" + src + "\\*' -DestinationPath '" + zip + "' -Force"], { encoding: 'utf8' });
if (ps.status !== 0 || !fs.existsSync(zip) || fs.statSync(zip).size === 0) {
  console.error('backup failed: ' + (ps.stderr || '').trim());
  process.exit(1);
}
console.log('backup: ' + zip + ' (' + Math.round(fs.statSync(zip).size / 1024) + ' KB)');
