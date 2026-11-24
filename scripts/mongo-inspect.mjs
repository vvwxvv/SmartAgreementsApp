#!/usr/bin/env node
/**
 * scripts/mongo-inspect.mjs  (P2-0.5, read-only)
 *
 * Prints the shape of the configured database without revealing credentials:
 *   node --env-file=.env scripts/mongo-inspect.mjs [--db=Name] [--json]
 *
 * Only ping/listCollections/count/indexes are called. No writes.
 */
import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const hit = argv.find((a) => a.startsWith('--' + n + '='));
  return hit ? hit.slice(n.length + 3) : d;
};
const jsonOut = argv.includes('--json');
const url = process.env.MONGODB_URL || '';
const dbName = argOf('db', process.env.MONGODB_DB || '');
if (!url || !dbName) {
  console.error('MONGODB_URL and MONGODB_DB are required (use --env-file=.env)');
  process.exit(2);
}

const safeTarget = (() => {
  try { const u = new URL(url); return u.protocol + '//' + u.host; } catch (e) { return '(unparseable url)'; }
})();

const client = new MongoClient(url, { serverSelectionTimeoutMS: 15000 });
try {
  await client.connect();
  const db = client.db(dbName);
  await db.command({ ping: 1 });
  const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
  const out = { target: safeTarget, database: dbName, collections: [] };
  for (const name of names) {
    const count = await db.collection(name).countDocuments({});
    const indexes = (await db.collection(name).indexes()).map((i) => ({ name: i.name, key: i.key, unique: Boolean(i.unique) }));
    out.collections.push({ name, count, indexes });
  }
  if (jsonOut) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('target   ' + out.target);
    console.log('database ' + out.database);
    for (const c of out.collections) {
      console.log('');
      console.log(c.name + '  docs=' + c.count);
      for (const i of c.indexes) {
        console.log('  index ' + i.name + ' ' + JSON.stringify(i.key) + (i.unique ? ' unique' : ''));
      }
    }
  }
} finally {
  await client.close();
}
