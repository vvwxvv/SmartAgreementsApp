#!/usr/bin/env node
/**
 * scripts/test-mongo.mjs  (P2-1.5 / E)
 *
 * One disposable MongoDB replica set on loopback:
 *   1. MongoMemoryReplSet.create()          (no external database)
 *   2. prisma db push --skip-generate       (no force-reset, no accept-data-loss)
 *   3. report collections + indexes
 *   4. scripts/check-schema-keys.mjs
 *   5. tests/regression.test.mjs            (12 cases)
 *   6. stop the server
 *
 * The database name is always agreement_test and the host is 127.0.0.1, so the
 * B guard accepts it and nothing outside this process can be touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { assertTestDatabase } from '../tests/db-guard.mjs';

const DB_NAME = 'agreement_test';
const repo = process.cwd();

function run(label, args, env) {
  console.log('');
  console.log('=== ' + label + ' ===');
  const res = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  console.log('=== ' + label + ': exit ' + res.status + ' ===');
  return res.status;
}

const repl = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
const baseUri = repl.getUri();
const [head, query] = baseUri.split('?');
const url = head.replace(/\/+$/, '') + '/' + DB_NAME + (query ? '?' + query : '');
assertTestDatabase(url, DB_NAME);

const env = {
  ...process.env,
  MONGODB_URL: url,
  MONGODB_DB: DB_NAME,
  TEST_MONGO: '1',
  TEST_MONGODB_URL: url,
  TEST_MONGODB_DB: DB_NAME,
  NEXT_TELEMETRY_DISABLED: '1',
};
delete env.DATA_SOURCE;

console.log('replica set: ' + baseUri.replace(/\/\/[^@]+@/, '//***@'));
console.log('test database: ' + DB_NAME);

let failed = false;
try {
  const prismaCli = path.join(repo, 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(prismaCli)) throw new Error('prisma CLI not found at ' + prismaCli);

  if (run('prisma db push', [prismaCli, 'db', 'push', '--skip-generate'], env) !== 0) failed = true;

  const client = new MongoClient(url);
  await client.connect();
  const db = client.db(DB_NAME);
  const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
  console.log('');
  console.log('collections after push: ' + (names.length ? names.join(', ') : '(none)'));
  for (const name of names) {
    const idx = (await db.collection(name).indexes()).map((i) => i.name + ' ' + JSON.stringify(i.key)).join(' | ');
    console.log('  ' + name + ': ' + idx);
  }
  await client.close();

  if (run('check-schema-keys', [path.join(repo, 'scripts', 'check-schema-keys.mjs')], env) !== 0) failed = true;

  if (run('regression (12)', ['--test', 'tests/regression.test.mjs'], env) !== 0) failed = true;
} finally {
  await repl.stop();
}

process.exit(failed ? 1 : 0);
