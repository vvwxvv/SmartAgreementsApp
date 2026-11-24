/**
 * localDb — a tiny, file-backed stand-in for the small subset of the MongoDB
 * driver this app uses, so the SAME business code runs with either:
 *
 *   DATA_SOURCE=local   →  src/data/collections/<Collection>.json
 *   DATA_SOURCE=mongo   →  MONGODB_URL / MONGODB_DB
 *
 * Scope is deliberately small: find (filter + sort + limit), findOne, insertOne,
 * insertMany, updateOne, updateMany, countDocuments and the one $group used for
 * signer counts. Anything outside that throws instead of silently misbehaving.
 */
import crypto from "node:crypto";
import fs from "fs/promises";
import path from "path";

let ROOT = path.join(process.cwd(), ".agreement-data");
const cache = new Map(); // collection -> array of docs

/** Point the adapter at a directory (and forget cached reads). Demo/test aid. */
export function configureFileDb(dir) {
  ROOT = path.resolve(dir);
  cache.clear();
}

/** Minimal ObjectId stand-in: hex string semantics, JSON-friendly. */
export class FileObjectId extends String {
  constructor(value) {
    super(value === undefined || value === null ? crypto.randomBytes(12).toString("hex") : String(value));
  }
  toHexString() {
    return String(this);
  }
}
let writeChain = Promise.resolve();

export const LOCAL_COLLECTIONS = ["Agreement", "AgreementSigner", "SigningEvent", "AgreementAttachment", "AdminGate"];

function fileFor(name) {
  return path.join(ROOT, `${name}.json`);
}

async function load(name) {
  if (cache.has(name)) return cache.get(name);
  let rows = [];
  try {
    const raw = await fs.readFile(fileFor(name), "utf8");
    rows = raw.trim() ? JSON.parse(raw) : [];
  } catch {
    rows = [];
  }
  cache.set(name, rows);
  return rows;
}

function persist(name) {
  const rows = cache.get(name) || [];
  const body = JSON.stringify(rows, null, 2);
  writeChain = writeChain.then(async () => {
    await fs.mkdir(ROOT, { recursive: true });
    const tmp = `${fileFor(name)}.tmp`;
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, fileFor(name));
  });
  return writeChain;
}

const idOf = (v) => (v && typeof v === "object" && typeof v.toHexString === "function" ? v.toHexString() : String(v));
const norm = (v) => (v === undefined || v === null ? "\u0000null" : idOf(v));
const same = (a, b) => norm(a) === norm(b);

function getPath(doc, key) {
  return key.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), doc);
}

function matchValue(actual, expected) {
  if (expected && typeof expected === "object" && !(expected instanceof Date) && !Array.isArray(expected)) {
    const ops = Object.keys(expected);
    if (ops.some((k) => k.startsWith("$"))) {
      return ops.every((op) => {
        const v = expected[op];
        switch (op) {
          case "$in":
            return v.some((x) => same(x, actual));
          case "$nin":
            return !v.some((x) => same(x, actual));
          case "$ne":
            return !same(v, actual);
          case "$eq":
            return same(v, actual);
          case "$regex":
            return new RegExp(v).test(String(actual ?? ""));
          case "$exists":
            return v ? actual !== undefined : actual === undefined;
          case "$gt":
            return actual > v;
          case "$gte":
            return actual >= v;
          case "$lt":
            return actual < v;
          case "$lte":
            return actual <= v;
          default:
            throw new Error(`localDb: unsupported operator ${op}`);
        }
      });
    }
  }
  if (expected instanceof Date || actual instanceof Date) {
    return new Date(actual).getTime() === new Date(expected).getTime();
  }
  return same(expected, actual);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, v]) => {
    if (k === "$or") return v.some((f) => matches(doc, f));
    if (k === "$and") return v.every((f) => matches(doc, f));
    return matchValue(getPath(doc, k), v);
  });
}

function applyUpdate(doc, update) {
  if (update.$set) {
    for (const [k, v] of Object.entries(update.$set)) doc[k] = v;
  }
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
  }
  if (update.$unset) {
    for (const k of Object.keys(update.$unset)) delete doc[k];
  }
  if (!update.$set && !update.$inc && !update.$unset) {
    Object.assign(doc, update);
  }
}

function compare(a, b) {
  const norm2 = (v) => (v instanceof Date ? v.toISOString() : v);
  const av = norm2(a);
  const bv = norm2(b);
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}

class Cursor {
  constructor(rows) {
    this.rows = rows;
  }
  sort(spec = {}) {
    const keys = Object.entries(spec);
    this.rows = [...this.rows].sort((a, b) => {
      for (const [k, dir] of keys) {
        const c = compare(getPath(a, k), getPath(b, k));
        if (c !== 0) return dir < 0 ? -c : c;
      }
      return 0;
    });
    return this;
  }
  limit(n) {
    if (n > 0) this.rows = this.rows.slice(0, n);
    return this;
  }
  async toArray() {
    return this.rows;
  }
}

function randomId() {
  let out = "";
  const h = "0123456789abcdef";
  for (let i = 0; i < 24; i += 1) out += h[Math.floor(Math.random() * 16)];
  return out;
}

class LocalCollection {
  constructor(name) {
    this.name = name;
    this.loaded = false;
    this.docs = [];
  }
  async ready() {
    if (!this.loaded) {
      this.docs = await load(this.name);
      this.loaded = true;
    }
    return this.docs;
  }
  find(filter = {}) {
    const self = this;
    const chain = {
      _sort: null,
      _limit: 0,
      sort(spec) {
        this._sort = spec;
        return this;
      },
      limit(n) {
        this._limit = n;
        return this;
      },
      async toArray() {
        const rows = (await self.ready()).filter((d) => matches(d, filter));
        const c = new Cursor(rows);
        if (this._sort) c.sort(this._sort);
        if (this._limit) c.limit(this._limit);
        return c.rows;
      },
    };
    return chain;
  }
  async findOne(filter = {}) {
    const rows = await this.ready();
    return rows.find((d) => matches(d, filter)) || null;
  }
  async insertOne(doc) {
    const rows = await this.ready();
    if (!doc._id) doc._id = randomId();
    rows.push(doc);
    await persist(this.name);
    return { insertedId: doc._id, acknowledged: true };
  }
  async insertMany(docs) {
    const rows = await this.ready();
    for (const d of docs) {
      if (!d._id) d._id = randomId();
      rows.push(d);
    }
    await persist(this.name);
    return { insertedCount: docs.length, acknowledged: true };
  }
  async updateOne(filter, update, options = {}) {
    const rows = await this.ready();
    const doc = rows.find((d) => matches(d, filter));
    if (!doc) {
      if (options.upsert) {
        const created = {};
        for (const [k, v] of Object.entries(filter)) if (!k.startsWith("$")) created[k] = v;
        applyUpdate(created, update.$set ? { $set: update.$set } : update);
        if (!created._id) created._id = randomId();
        rows.push(created);
        await persist(this.name);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
    applyUpdate(doc, update);
    await persist(this.name);
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async updateMany(filter, update) {
    const rows = await this.ready();
    const hit = rows.filter((d) => matches(d, filter));
    hit.forEach((d) => applyUpdate(d, update));
    if (hit.length) await persist(this.name);
    return { matchedCount: hit.length, modifiedCount: hit.length };
  }
  async deleteOne(filter = {}) {
    const rows = await this.ready();
    const idx = rows.findIndex((d) => matches(d, filter));
    if (idx === -1) return { acknowledged: true, deletedCount: 0 };
    rows.splice(idx, 1);
    await persist(this.name);
    return { acknowledged: true, deletedCount: 1 };
  }

  async deleteMany(filter = {}) {
    const rows = await this.ready();
    const keep = rows.filter((d) => !matches(d, filter));
    const removed = rows.length - keep.length;
    if (!removed) return { acknowledged: true, deletedCount: 0 };
    rows.length = 0; rows.push(...keep);
    await persist(this.name);
    return { acknowledged: true, deletedCount: removed };
  }

  async countDocuments(filter = {}) {
    const rows = await this.ready();
    return rows.filter((d) => matches(d, filter)).length;
  }
  aggregate(pipeline) {
    // Only the signer-count pipeline is used: $match → $group.
    // Returns a cursor-like object so callers can keep `.toArray()`.
    return { toArray: () => this._aggregate(pipeline) };
  }
  async _aggregate(pipeline) {
    let rows = await this.ready();
    for (const stage of pipeline) {
      if (stage.$match) {
        rows = rows.filter((d) => matches(d, stage.$match));
      } else if (stage.$group) {
        const groups = new Map();
        for (const d of rows) {
          const key = idOf(getPath(d, String(stage.$group._id).replace(/^\$/, "")));
          const g = groups.get(key) || { _id: key };
          for (const [field, spec] of Object.entries(stage.$group)) {
            if (field === "_id") continue;
            if (spec && typeof spec === "object" && "$sum" in spec) {
              const expr = spec.$sum;
              if (typeof expr === "number") {
                g[field] = (g[field] || 0) + expr;
              } else if (expr && expr.$cond) {
                const [cond, yes, no] = expr.$cond;
                const [a, b] = cond.$ne || [];
                const val = getPath(d, String(a).replace(/^\$/, ""));
                g[field] = (g[field] || 0) + (!same(val, b) ? yes : no);
              }
            }
          }
          groups.set(key, g);
        }
        rows = [...groups.values()];
      } else {
        throw new Error(`localDb: unsupported aggregate stage ${Object.keys(stage)[0]}`);
      }
    }
    return rows;
  }
}

export function getLocalDb() {
  return {
    collection(name) {
      return new LocalCollection(name);
    },
  };
}

export async function localStats() {
  const db = getLocalDb();
  const out = {};
  for (const c of LOCAL_COLLECTIONS) out[c] = await db.collection(c).countDocuments({});
  return out;
}
