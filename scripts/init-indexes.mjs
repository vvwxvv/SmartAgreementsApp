#!/usr/bin/env node
/**
 * scripts/init-indexes.mjs — create the Mongo indexes Prisma db push does not.
 *
 * TEST DATABASE ONLY: TEST_MONGODB_URL + TEST_MONGODB_DB, *_test, loopback.
 * Duplicate values are reported and stop the run before any unique index is made.
 * A pre-existing non-partial unique index on accessTokenHash requires --migrate.
 */
import { MongoClient } from 'mongodb';
import { assertTestDatabase } from '../tests/db-guard.mjs';
import { INDEX_SPEC } from './lib/indexSpec.mjs';

const url = process.env.TEST_MONGODB_URL || '';
const dbName = process.env.TEST_MONGODB_DB || '';
try {
  assertTestDatabase(url, dbName);
} catch (e) {
  console.error('refusing: ' + e.message);
  process.exit(2);
}
const migrate = process.argv.includes('--migrate');

const client = new MongoClient(url);
await client.connect();
const db = client.db(dbName);

async function duplicates(collection, key) {
  return db.collection(collection).aggregate([
    { $group: { _id: key, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray();
}

const dupNumber = await duplicates('Agreement', { number: '$number' });
const dupSigner = await duplicates('AgreementSigner', { agreementId: '$agreementId', email: '$email' });
if (dupNumber.length || dupSigner.length) {
  console.error('duplicates found; resolve before indexing:');
  if (dupNumber.length) console.error('  Agreement.number: ' + dupNumber.length + ' group(s)');
  if (dupSigner.length) console.error('  AgreementSigner(agreementId,email): ' + dupSigner.length + ' group(s)');
  await client.close();
  process.exit(1);
}

const existing = await db.collection('AgreementSigner').indexes();
const fullUnique = existing.find((i) => i.unique && i.key && i.key.accessTokenHash === 1 && !i.partialFilterExpression);
if (fullUnique && !migrate) {
  console.error('a full unique index on accessTokenHash exists (' + fullUnique.name + '); re-run with --migrate to replace it');
  await client.close();
  process.exit(1);
}
if (fullUnique && migrate) {
  await db.collection('AgreementSigner').dropIndex(fullUnique.name);
  console.log('dropped ' + fullUnique.name);
}

for (const spec of INDEX_SPEC) {
  await db.collection(spec.collection).createIndex(spec.keys, spec.options);
}

console.log('indexes ensured on ' + dbName);
await client.close();
