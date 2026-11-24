/**
 * siteMetaServer.js — server-side helpers for the singleton `Meta` document.
 *
 * Used by `/api/meta` (GET/PUT) and by anything server-side that needs the
 * site meta before render. Falls back to the JSON defaults when the DB is
 * unavailable, so the app never hard-fails on a Meta problem.
 */

import { getDb } from "@/app/api/_lib/mongo";
import { getDefaultSiteMeta, mergeSiteMeta } from "@/utils/siteMetaDefaults";

export const META_COLLECTION = "Meta";

/** Follow the app's data source: Mongo in production, JSON collections when
 *  DATA_SOURCE=local. A separate MongoClient here used to ignore local mode,
 *  so the footer always showed defaults in demos. */
async function connectDB() {
  return getDb();
}

/** Read the doc, creating it from the defaults when it does not exist yet.
 *
 * The collection is meant to hold a SINGLE document, but imports / manual edits
 * can leave several. Always read the MOST RECENTLY UPDATED one so the site
 * reflects the latest save (never an arbitrary/older doc).
 */
export async function readMetaDoc() {
  const db = await connectDB();
  const collection = db.collection(META_COLLECTION);
  // toArray() works on both the Mongo driver and the local JSON cursor
  // (which has no .next()); take the first row either way.
  const rows = await collection
    .find({})
    .sort({ updatedAt: -1, _id: -1 }) // newest first; _id breaks ties
    .limit(1)
    .toArray();
  let doc = rows[0] || null;
  if (!doc) {
    const defaults = getDefaultSiteMeta();
    const res = await collection.insertOne({ ...defaults, updatedAt: new Date() });
    doc = { ...defaults, _id: res.insertedId, updatedAt: new Date() };
  }
  return { collection, doc };
}

/** Doc merged over the defaults (complete, safe shape). */
export async function getMetaMerged() {
  try {
    const { doc } = await readMetaDoc();
    const plain = { ...doc };
    delete plain._id;
    return mergeSiteMeta(getDefaultSiteMeta(), plain);
  } catch (error) {
    console.log("[siteMetaServer] getMetaMerged failed:", error);
    return getDefaultSiteMeta();
  }
}

/** $set a sanitized patch onto the LATEST doc and return it. */
export async function updateMetaDoc(patch) {
  // Consolidate first: if the collection accumulated duplicate Meta docs
  // (imports / manual edits), keep the newest and archive the rest so the
  // save always lands on the single live document.
  await dedupeMetaDocs().catch((err) =>
    console.log("[siteMetaServer] dedupe skipped:", err?.message || err)
  );

  const { collection, doc } = await readMetaDoc();
  const filter = doc?._id ? { _id: doc._id } : {};
  await collection.updateOne(
    filter,
    { $set: { ...patch, updatedAt: new Date() } },
    { upsert: true }
  );
  // Re-read the latest so the response always matches what GET would return.
  return collection
    .find({})
    .sort({ updatedAt: -1, _id: -1 })
    .limit(1)
    .next();
}

/**
 * Dedupe the singleton Meta collection: keep the MOST RECENTLY UPDATED doc and
 * move every older one into `Meta_archive` (never hard-deleted, so a mistaken
 * "latest" can still be recovered). No-op when there is zero/one document.
 *
 * @returns {{ removed: number, kept: any, archived: boolean }}
 */
export async function dedupeMetaDocs({ log = console.log } = {}) {
  const db = await connectDB();
  const collection = db.collection(META_COLLECTION);
  const docs = await collection
    .find({})
    .sort({ updatedAt: -1, _id: -1 })
    .toArray();

  if (docs.length <= 1) {
    return { removed: 0, kept: docs[0]?._id ?? null, archived: true };
  }

  const [keep, ...stale] = docs;
  const staleIds = stale.map((d) => d._id);

  // Archive a copy first (recoverable), then remove from the live collection.
  const archive = db.collection(`${META_COLLECTION}_archive`);
  await archive.insertMany(
    stale.map((d) => ({ ...d, archivedAt: new Date() })),
    { ordered: false }
  ).catch((err) =>
    log("[siteMetaServer] archive insert failed:", err?.message || err)
  );

  const res = await collection.deleteMany({ _id: { $in: staleIds } });
  log(
    `[siteMetaServer] dedupe: kept ${String(keep._id)} | archived/removed ` +
      `${res.deletedCount} duplicate Meta doc(s)`
  );
  return { removed: res.deletedCount, kept: keep._id, archived: true };
}
