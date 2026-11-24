#!/usr/bin/env node
/**
 * scripts/probe-db-push.mjs  (P2-1.5 / E)
 *
 * Diagnostic: does prisma db push create collections, and does it create
 * indexes on pre-existing empty collections? Runs entirely on a loopback
 * MongoMemoryReplSet; no external database is contacted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

const DB = 'agreement_test';
const MODELS = ['Agreement', 'AgreementSigner', 'SigningEvent', 'User', 'Session', 'LoginCode', 'Meta', 'AdminGate'];
const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const [head, query] = repl.getUri().split('?');
const url = head.replace(/\/+$/, '') + '/' + DB + (query ? '?' + query : '');
const env = { ...process.env, MONGODB_URL: url, MONGODB_DB: DB };

function push(label) {
  const res = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], { env, encoding: 'utf8' });
  console.log('--- ' + label + ' exit=' + res.status + ' ---');
  console.log((res.stdout || '').trim());
  if (res.stderr) console.log((res.stderr || '').trim());
}

const client = new MongoClient(url);
await client.connect();
const db = client.db(DB);

push('empty database');
console.log('collections after push #1: ' + JSON.stringify((await db.listCollections().toArray()).map((c) => c.name)));

for (const name of MODELS) {
  try { await db.createCollection(name); } catch (e) { if (e.codeName !== 'NamespaceExists') throw e; }
}
push('after creating empty collections');
for (const name of MODELS) {
  const idx = (await db.collection(name).indexes()).map((i) => ({ name: i.name, key: i.key, unique: Boolean(i.unique) }));
  console.log(name + ' indexes: ' + JSON.stringify(idx));
}

await client.close();
await repl.stop();
