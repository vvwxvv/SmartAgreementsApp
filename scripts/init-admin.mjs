#!/usr/bin/env node
/**
 * scripts/init-admin.mjs — configure the admin gate ONCE, locally.
 *
 * Usage:
 *   npm run init:admin -- --p1=1,2,3,6 --p2=9,8,7,4
 *   ADMIN_P1=1,2,3,6 ADMIN_P2=9,8,7,4 npm run init:admin
 *
 * Local data only in Phase 1. Uses the same hash as unlock (adminGateHash.js).
 * Refuses when the gate is already configured.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validPattern, hashPattern, gateSecret } from '../src/agreement/adminGateHash.js';
import { resolveDataSource } from '../src/lib/dataSource.js';

const args = process.argv.slice(2);
const argOf = (name) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};
const parse = (v) => String(v || '').split(',').map((s) => Number(s.trim())).filter(Number.isFinite);

const p1 = parse(argOf('p1') || process.env.ADMIN_P1 || '');
const p2 = parse(argOf('p2') || process.env.ADMIN_P2 || '');
if (!validPattern(p1) || !validPattern(p2)) {
  console.error('patterns must be 4-9 distinct dots, each 1-9');
  process.exit(2);
}
if (p1.join('-') === p2.join('-')) {
  console.error('the two patterns must differ');
  process.exit(2);
}

const ds = resolveDataSource();
if (ds.resolved !== 'local') {
  console.error('refusing: init-admin is local-only in Phase 1 (DATA_SOURCE resolves to ' + ds.resolved + ')');
  process.exit(2);
}

const dir = path.resolve(process.env.LOCAL_DATA_DIR || path.join(process.cwd(), 'src', 'data', 'collections'));
const file = path.join(dir, 'AdminGate.json');
if (fs.existsSync(file)) {
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { rows = []; }
  const doc = Array.isArray(rows) ? rows.find((r) => r && r._id === 'gate') : null;
  if (doc && doc.p1 && doc.p2) {
    console.error('admin gate is already configured; reset it with scripts/reset-admin-gate.mjs');
    process.exit(1);
  }
  // Keep the backup next to the data (portable), not on a hard-coded drive.
  const backupDir = path.join(dir, '_backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(backupDir, 'AdminGate-' + stamp + '.json'));
  console.log('backup: AdminGate-' + stamp + '.json');
}

const now = new Date().toISOString();
const doc = {
  _id: 'gate',
  p1: hashPattern(1, p1),
  p2: hashPattern(2, p2),
  createdAt: now,
  updatedAt: now,
};
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, JSON.stringify([doc], null, 2) + '\n', 'utf8');
console.log('admin gate configured in ' + dir + ' (' + (gateSecret() ? 'v2, keyed' : 'v1, unkeyed — set ADMIN_SESSION_SECRET to key it') + ')');
