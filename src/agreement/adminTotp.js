import { getDb } from "@/app/api/_lib/mongo";
import { openSecret, sealSecret, totpKey, verifyTotp } from "@/lib/totp";

const COLL = "AdminGate";
const DOC_ID = "gate";

/** Dedicated key wins; otherwise reuse the gate key. Rotating either requires
 *  re-enrolling TOTP (the CLI is the recovery path). */
function sealingSecret() {
  return process.env.ADMIN_TOTP_KEY || process.env.ADMIN_GATE_SECRET || process.env.ADMIN_SESSION_SECRET || "";
}

export async function totpStatus() {
  const db = await getDb();
  const doc = await db.collection(COLL).findOne({ _id: DOC_ID });
  return { configured: Boolean(doc?.totpSecret), scheme: doc?.totpSecret ? "aes-256-gcm" : null };
}

/**
 * Store a new shared secret. Called by scripts/init-totp.mjs and tests; never by
 * an HTTP route (enrollment must not be reachable from the browser).
 */
export async function setTotpSecret(secret) {
  const key = totpKey(sealingSecret());
  const db = await getDb();
  await db.collection(COLL).updateOne(
    { _id: DOC_ID },
    {
      $set: {
        totpSecret: sealSecret(secret, key),
        totpEnabled: true,
        totpLastStep: null,
        totpUpdatedAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  return true;
}

export async function clearTotp() {
  const db = await getDb();
  await db.collection(COLL).updateOne(
    { _id: DOC_ID },
    { $set: { totpSecret: null, totpEnabled: false, totpLastStep: null, totpUpdatedAt: new Date(), updatedAt: new Date() } }
  );
  return true;
}

/**
 * Verify a code for the stored secret, with replay protection: a code that was
 * already accepted in this time step cannot be used again.
 *
 * @returns {{ ok: boolean, notConfigured?: boolean, replay?: boolean, error?: string }}
 */
export async function verifyGateTotp(code) {
  const db = await getDb();
  const col = db.collection(COLL);
  const doc = await col.findOne({ _id: DOC_ID });
  if (!doc?.totpSecret) return { ok: true, notConfigured: true };

  let secret;
  try {
    secret = openSecret(doc.totpSecret, totpKey(sealingSecret()));
  } catch {
    // Usually a rotated ADMIN_SESSION_SECRET: fail closed instead of letting
    // anyone through, and tell the operator what to do.
    return { ok: false, error: "TOTP 密钥无法解密：请重新运行 init:totp（或恢复 ADMIN_TOTP_KEY）" };
  }

  const result = verifyTotp(secret, code);
  if (!result.ok) return { ok: false };

  // A code from this (or an earlier) step must not be accepted twice.
  const last = Number.isFinite(doc.totpLastStep) ? doc.totpLastStep : -1;
  if (result.step <= last) return { ok: false, replay: true };

  const prev = doc.totpLastStep ?? null;
  const res = await col.updateOne(
    { _id: DOC_ID, totpLastStep: prev },
    { $set: { totpLastStep: result.step, totpUsedAt: new Date() } }
  );
  if (res.modifiedCount !== 1) return { ok: false, replay: true };
  return { ok: true };
}
