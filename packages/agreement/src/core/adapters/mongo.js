/**
 * Mongo adapter. `mongodb` is imported lazily so hosts that use another
 * adapter never pay for the driver (and never fail without it installed).
 */
export async function createMongoStorage({ url, db, client } = {}) {
  let conn = client;
  if (!conn) {
    let MongoClient;
    try {
      ({ MongoClient } = await import("mongodb"));
    } catch {
      throw new Error("mongodb is not installed; run `npm i mongodb` to use this adapter");
    }
    if (!url) throw new Error("createMongoStorage: url is required when client is not provided");
    conn = new MongoClient(url);
    await conn.connect();
  }
  const database = typeof db === "string" ? conn.db(db) : db;
  const { createStorage } = await import("../index.js");
  return createStorage(database);
}
