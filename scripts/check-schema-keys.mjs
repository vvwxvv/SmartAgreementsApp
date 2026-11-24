#!/usr/bin/env node
/**
 * scripts/check-schema-keys.mjs  (P2-0)
 *
 * Assert that every field present in a collection is declared in prisma/schema.prisma,
 * and that its value matches the declared Prisma type.
 *
 *   node scripts/check-schema-keys.mjs                 # Mongo (MONGODB_URL/MONGODB_DB)
 *   DATA_SOURCE=local node scripts/check-schema-keys.mjs
 *   node scripts/check-schema-keys.mjs --collection=Agreement --limit=100 --json
 *
 * Exit codes: 0 clean, 1 schema drift found, 2 configuration error.
 *
 * Read-only: never writes to the database or to schema.prisma.
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertTestDatabase } from '../tests/db-guard.mjs';

const ROOT = process.cwd();
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma');
const LOCAL_DIR = path.join(ROOT, 'src', 'data', 'collections');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const onlyCollection = argOf('collection', '');
const limit = Number(argOf('limit', '0')) || 0;
const asJson = argv.includes('--json');
const localMode = String(process.env.DATA_SOURCE || '').trim().toLowerCase() === 'local';
const readOnlyAck = argv.includes('--i-know-this-is-read-only');

// Mongo mode is read-only, but it still must not silently connect to a
// production database. Test DBs pass the guard; anything else needs an
// explicit acknowledgement flag.
if (!localMode && !readOnlyAck) {
  try {
    assertTestDatabase(process.env.MONGODB_URL, process.env.MONGODB_DB);
  } catch (e) {
    console.error('refusing Mongo mode: ' + e.message);
    console.error('use a loopback *_test database, or pass --i-know-this-is-read-only');
    process.exit(2);
  }
}

/* ---------------- schema parser ---------------- */

function parseSchema(text) {
  const models = {};
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = modelRe.exec(text))) {
    const name = m[1];
    const body = m[2];
    const fields = {};
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      if (!line || line.startsWith('@@')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const fieldName = parts[0];
      const fieldType = parts[1];
      const rest = parts.slice(2).join(' ');
      fields[fieldName] = {
        name: fieldName,
        type: fieldType.replace(/[\[\]?]/g, ''),
        rawType: fieldType,
        optional: fieldType.indexOf('?') !== -1 || fieldType.indexOf('[]') !== -1,
        objectId: /@db\.ObjectId/.test(rest),
        mapped: /@map\("_id"\)/.test(rest),
      };
    }
    models[name] = { name, fields };
  }
  return models;
}

/* ---------------- value classification ---------------- */

function classify(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (v instanceof Date) return 'date';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') {
    if (typeof v.toHexString === 'function') return 'objectid';
    return 'object';
  }
  return typeof v;
}

function fits(field, value) {
  const kind = classify(value);
  if (kind === 'null' || kind === 'undefined') return true; // optional / unset
  switch (field.type) {
    case 'String':
      if (kind === 'string') return true;
      return field.objectId && kind === 'objectid';
    case 'Int':
      return kind === 'number' && Number.isInteger(value);
    case 'Float':
    case 'Decimal':
      return kind === 'number' && Number.isFinite(value);
    case 'BigInt':
      return kind === 'number' || kind === 'string';
    case 'Boolean':
      return kind === 'boolean';
    case 'DateTime':
      return kind === 'date' || (localMode && kind === 'string' && !Number.isNaN(Date.parse(value)));
    case 'Json':
      return ['object', 'array', 'string', 'number', 'boolean'].indexOf(kind) !== -1;
    default:
      return true; // enums and future types are not judged here
  }
}

/* ---------------- loaders ---------------- */

function loadLocal() {
  const out = [];
  if (!fs.existsSync(LOCAL_DIR)) return out;
  for (const file of fs.readdirSync(LOCAL_DIR)) {
    if (!file.endsWith('.json')) continue;
    const name = file.replace(/\.json$/, '');
    if (onlyCollection && onlyCollection !== name) continue;
    let rows = [];
    try {
      const raw = fs.readFileSync(path.join(LOCAL_DIR, file), 'utf8');
      rows = raw.trim() ? JSON.parse(raw) : [];
    } catch (e) {
      throw new Error('cannot parse ' + file + ': ' + e.message);
    }
    out.push({ name, rows, source: 'local' });
  }
  return out;
}

async function loadMongo() {
  const url = process.env.MONGODB_URL || '';
  const dbName = process.env.MONGODB_DB || '';
  if (!url || !dbName) throw new Error('MONGODB_URL and MONGODB_DB are required (or set DATA_SOURCE=local)');
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db(dbName);
  const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
  const out = [];
  for (const name of names) {
    if (onlyCollection && onlyCollection !== name) continue;
    let cursor = db.collection(name).find({});
    if (limit) cursor = cursor.limit(limit);
    const rows = await cursor.toArray();
    out.push({ name, rows, source: 'mongo' });
  }
  await client.close();
  return out;
}

/* ---------------- main ---------------- */

async function main() {
  if (!fs.existsSync(SCHEMA)) throw new Error('missing ' + SCHEMA);
  const models = parseSchema(fs.readFileSync(SCHEMA, 'utf8'));
  const collections = localMode ? loadLocal() : await loadMongo();

  const report = { mode: localMode ? 'local' : 'mongo', checkedAt: new Date().toISOString(), collections: [], issues: 0 };

  // An empty database must never report "clean": it proves nothing.
  if (!collections.length) {
    report.empty = true;
    report.issues += 1;
  }

  for (const coll of collections) {
    const model = models[coll.name];
    const entry = {
      collection: coll.name,
      documents: coll.rows.length,
      declared: Boolean(model),
      unknownFields: {},
      typeMismatches: [],
    };

    if (!model) {
      entry.unknownFields['<collection>'] = coll.rows.length ? coll.rows.length : 1;
      report.issues += 1;
      report.collections.push(entry);
      continue;
    }

    const declared = Object.keys(model.fields);
    const seen = {};
    const sampleByField = {};

    for (const row of coll.rows) {
      for (const key of Object.keys(row)) {
        if (key === '_id' || key === '__v') continue;
        seen[key] = (seen[key] || 0) + 1;
        if (!model.fields[key]) {
          entry.unknownFields[key] = (entry.unknownFields[key] || 0) + 1;
          if (!sampleByField[key]) sampleByField[key] = String(row._id || '');
          continue;
        }
        if (!fits(model.fields[key], row[key])) {
          if (entry.typeMismatches.length < 20) {
            entry.typeMismatches.push({
              field: key,
              expected: model.fields[key].rawType,
              got: classify(row[key]),
              sampleId: String(row._id || ''),
            });
          }
        }
      }
    }

    const unknownCount = Object.keys(entry.unknownFields).length;
    if (unknownCount) report.issues += 1;
    if (entry.typeMismatches.length) report.issues += 1;

    entry.declaredFields = declared.length;
    entry.observedFields = Object.keys(seen).length;
    entry.samples = sampleByField;
    report.collections.push(entry);
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('schema-key check  mode=' + report.mode + '  models=' + Object.keys(models).length);
    if (report.empty) console.log('no collections found: an empty database is not a pass');
    for (const c of report.collections) {
      const unknown = Object.keys(c.unknownFields);
      const status = (unknown.length || c.typeMismatches.length) ? 'DRIFT' : 'ok';
      console.log('');
      console.log('[' + status + '] ' + c.collection + '  docs=' + c.documents +
        '  declared=' + (c.declared ? c.declaredFields : '-') + '  observed=' + (c.observedFields || 0));
      if (!c.declared) {
        console.log('  collection is not declared in prisma/schema.prisma');
      }
      for (const k of unknown) {
        console.log('  unknown field: ' + k + ' (' + c.unknownFields[k] + ' docs)');
      }
      for (const t of c.typeMismatches) {
        console.log('  type: ' + t.field + ' expected ' + t.expected + ' got ' + t.got + ' [' + t.sampleId + ']');
      }
    }
    console.log('');
    console.log(report.issues ? 'RESULT: ' + report.issues + ' collection(s) with drift' : 'RESULT: clean');
  }

  process.exit(report.issues ? 1 : 0);
}

main().catch((e) => {
  console.error('check-schema-keys: ' + e.message);
  process.exit(2);
});
