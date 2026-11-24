import { getDb } from "@/app/api/_lib/mongo";
import {
  gateSecret,
  hashPattern,
  hashPatternLegacy,
  hashPatternV2,
  isV2Hash,
  safeEqual,
  validPattern,
} from "./adminGateHash.js";

const COLL = "AdminGate";
const DOC_ID = "gate";

export { validPattern };

export async function gateStatus() {
  const db = await getDb();
  const doc = await db.collection(COLL).findOne({ _id: DOC_ID });
  return {
    configured: Boolean(doc?.p1 && doc?.p2),
    // Expose the scheme so the operator can see whether the stored digests are
    // keyed yet; the digests themselves never leave the server.
    scheme: doc?.p1 ? (isV2Hash(doc.p1) ? "v2" : "v1") : null,
  };
}

/** First-run setup: two DIFFERENT patterns, both required to unlock. */
export async function setupGate(p1, p2) {
  if (!validPattern(p1) || !validPattern(p2)) throw new Error("每个手势至少连接 4 个点");
  if (p1.join("-") === p2.join("-")) throw new Error("两个手势不能相同");

  const db = await getDb();
  const col = db.collection(COLL);
  const existing = await col.findOne({ _id: DOC_ID });
  if (existing?.p1 && existing?.p2) throw new Error("手势已设置；如需重置，请在服务器上运行重置脚本");

  await col.updateOne(
    { _id: DOC_ID },
    {
      $set: {
        p1: hashPattern(1, p1),
        p2: hashPattern(2, p2),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  return true;
}

function matches(slot, pattern, stored) {
  if (!stored) return false;
  const secret = gateSecret();
  if (isV2Hash(stored)) {
    if (!secret) return false; // keyed rows cannot be checked without the key
    return safeEqual(hashPatternV2(slot, pattern, secret), stored);
  }
  // Legacy row: compare the old unkeyed digest, then upgrade in place.
  return safeEqual(hashPatternLegacy(slot, pattern), stored);
}

/** Unlock: both drawings must match their own slot. */
export async function checkGate(p1, p2) {
  const db = await getDb();
  const col = db.collection(COLL);
  const doc = await col.findOne({ _id: DOC_ID });
  if (!doc?.p1 || !doc?.p2) throw new Error("还没有设置手势");

  const a = matches(1, p1 || [], doc.p1);
  const b = matches(2, p2 || [], doc.p2);
  const ok = a && b;

  // Transparent upgrade: after a successful unlock with a server secret
  // available, rewrite unkeyed digests so a later DB leak cannot be cracked.
  if (ok && gateSecret() && (!isV2Hash(doc.p1) || !isV2Hash(doc.p2))) {
    await col.updateOne(
      { _id: DOC_ID },
      {
        $set: {
          p1: hashPatternV2(1, p1 || [], gateSecret()),
          p2: hashPatternV2(2, p2 || [], gateSecret()),
          updatedAt: new Date(),
        },
      }
    );
  }

  return ok;
}
