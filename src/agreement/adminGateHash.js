import crypto from "node:crypto";

/** Admin gate hashing — one source of truth for init and unlock.
 *
 *  Patterns are low-entropy (4–9 dots on a 3×3 grid). A bare SHA-256 in the
 *  database is crackable offline in minutes if the DB leaks. When a server
 *  secret is available we key the digest (HMAC) and tag it "v2:"; records
 *  written before that stay readable and are upgraded on the next unlock.
 */

export const GATE_SCHEME_V2 = "v2:";
export const MIN_PEPPER_LENGTH = 16;

export function validPattern(p) {
  return (
    Array.isArray(p) &&
    p.length >= 4 &&
    p.length <= 9 &&
    p.every((n) => Number.isInteger(n) && n >= 1 && n <= 9) &&
    new Set(p).size === p.length
  );
}

/** Server-side pepper for the gesture digests.
 *
 *  Deliberately a DEDICATED variable: falling back to ADMIN_SESSION_SECRET would
 *  mean that rotating it (the documented way to log everyone out) also locks the
 *  gate, because the stored HMACs can no longer be checked. Set
 *  ADMIN_GATE_SECRET once; when it is absent the gate stays on the legacy
 *  unkeyed digest and setup warns about it. */
export function gateSecret(env = process.env) {
  const value = String(env.ADMIN_GATE_SECRET || "");
  return value.length >= MIN_PEPPER_LENGTH ? value : "";
}

function material(slot, pattern) {
  return "admin:" + slot + ":" + pattern.join("-");
}

/** Legacy digest (unkeyed). Kept only for rows written before v2. */
export function hashPatternLegacy(slot, pattern) {
  return crypto.createHash("sha256").update(material(slot, pattern)).digest("hex");
}

/** v2 digest: HMAC-SHA256 with the server secret, prefixed for detection. */
export function hashPatternV2(slot, pattern, secret = gateSecret()) {
  if (!secret) throw new Error("gateSecret is required for v2 hashes");
  const digest = crypto.createHmac("sha256", secret).update(material(slot, pattern)).digest("hex");
  return GATE_SCHEME_V2 + digest;
}

/** Default writer: v2 when a secret exists, legacy otherwise (dev machines). */
export function hashPattern(slot, pattern, secret = gateSecret()) {
  return secret ? hashPatternV2(slot, pattern, secret) : hashPatternLegacy(slot, pattern);
}

export function isV2Hash(value) {
  return String(value || "").startsWith(GATE_SCHEME_V2);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
