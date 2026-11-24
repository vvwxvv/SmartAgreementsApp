#!/usr/bin/env node
/**
 * scripts/db-push-safe.mjs
 *
 * The only sanctioned way to run `prisma db push` from this repo.
 * It reads TEST_MONGODB_URL / TEST_MONGODB_DB only, refuses anything that is
 * not loopback + *_test, and passes that URL explicitly to the child process.
 * It never reads MONGODB_URL, so .env cannot point it at production.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertTestDatabase } from '../tests/db-guard.mjs';

const url = process.env.TEST_MONGODB_URL || '';
const db = process.env.TEST_MONGODB_DB || '';
try {
  assertTestDatabase(url, db);
} catch (e) {
  console.error('refusing: ' + e.message);
  console.error('set TEST_MONGODB_URL + TEST_MONGODB_DB to a loopback *_test database');
  process.exit(2);
}

const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const res = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], {
  stdio: 'inherit',
  env: { ...process.env, MONGODB_URL: url, MONGODB_DB: db },
});
process.exit(res.status === null ? 1 : res.status);
