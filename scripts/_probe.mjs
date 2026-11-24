import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URL);
await c.connect();
const db = c.db(process.env.MONGODB_DB);
try {
  await db.collection('__p2_probe').insertOne({ at: new Date(), note: 'permission probe' });
  console.log('WRITE_OK');
  try { await db.collection('__p2_probe').drop(); console.log('DROP_OK'); }
  catch (e) { console.log('DROP_DENIED ' + (e.codeName || e.code) + ' ' + e.message); }
} catch (e) {
  console.log('WRITE_DENIED ' + (e.codeName || e.code) + ' ' + e.message);
} finally { await c.close(); }
