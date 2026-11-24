/**
 * Invite-link sealing (AES-256-GCM).
 *
 * A signer invite token is a bearer credential, and we keep it encrypted at
 * rest so an operator can copy the same link again later. Two properties
 * matter beyond plain confidentiality:
 *
 *   1. **Binding** — the ciphertext must only open for the record it was
 *      written for. Swapping two signers' blobs inside the database must not
 *      turn "copy signer B's link" into a link labelled with signer A.
 *      v2 therefore authenticates the AAD `"<agreementId>:<signerId>"`.
 *   2. **Rotation** — the key lives in the environment and will be rotated.
 *      Each key gets a short `kid`; v2 blobs carry it, and the reader accepts
 *      the current key plus an explicit list of previous keys.
 *
 * v1 blobs (no kid, no AAD) stay readable during the migration window so
 * existing links do not break; `signing.js` silently re-seals them as v2 on
 * the next read, which closes the window without touching the token itself.
 */
import crypto from "node:crypto";

export const LINK_SEAL_PREFIX = "v2";
export const LINK_SEAL_VERSION = 2;
const MIN_RAW_KEY_LENGTH = 32;

/** Accept a base64 32-byte key or any long random string (hashed to 32 bytes).
 *  Returns null for an unusable key so callers can decide whether to fail. */
export function deriveLinkKey(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const maybe = Buffer.from(text, "base64");
  const roundTrips = maybe.toString("base64").replace(/=+$/, "") === text.replace(/=+$/, "");
  if (maybe.length === 32 && roundTrips) return maybe;
  if (text.length < MIN_RAW_KEY_LENGTH) return null;
  return crypto.createHash("sha256").update(text).digest();
}

/** Stable, non-secret identifier for a key (first 8 hex of its SHA-256). */
export function linkKeyId(key) {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/**
 * @param {object} deps
 * @param {string|(() => string)} deps.currentKey  key used for new blobs
 * @param {string|string[]|(() => string|string[])} [deps.previousKeys]
 *        keys still accepted for reading (rotation window)
 * @param {string} [deps.requiredKeyError] message thrown when no key is set
 */
export function createLinkSealer({ currentKey, previousKeys = [], requiredKeyError = "AGREEMENT_LINK_KEY 未配置：无法保存或取回邀请链接" } = {}) {
  const read = (v) => (typeof v === "function" ? v() : v);

  function current() {
    const key = deriveLinkKey(read(currentKey));
    if (!key) throw new Error(requiredKeyError);
    return key;
  }

  function accepted() {
    const out = [];
    let primary = null;
    try {
      primary = current();
    } catch {
      primary = null;
    }
    if (primary) out.push(primary);
    const list = read(previousKeys);
    const rows = Array.isArray(list) ? list : String(list || "").split(",");
    for (const row of rows) {
      const key = deriveLinkKey(row);
      // A malformed previous key must not break the current one: skip it and
      // let the operator notice via the `failed` list in getLinks().
      if (key && !out.some((k) => k.equals(key))) out.push(key);
    }
    return out;
  }

  const kid = () => linkKeyId(current());

  /** @param {string} token @param {string} aad `<agreementId>:<signerId>` */
  function seal(token, aad) {
    const binding = String(aad ?? "");
    if (!binding) throw new Error("sealToken: 缺少 AAD（agreementId:signerId），拒绝写入未绑定记录");
    const key = current();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(binding, "utf8"));
    const ct = Buffer.concat([cipher.update(String(token), "utf8"), cipher.final()]);
    return [
      LINK_SEAL_PREFIX,
      linkKeyId(key),
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ct.toString("base64url"),
    ].join(".");
  }

  /** @returns {{token: string, version: 1|2, kid: string|null}|null} */
  function openDetailed(blob, aad) {
    try {
      const parts = String(blob ?? "").split(".");
      const binding = String(aad ?? "");

      if (parts.length === 4 && parts[0] === "v1") {
        // Legacy: no kid, no AAD. Try every accepted key so a rotated key does
        // not strand blobs written before the rotation.
        for (const key of accepted()) {
          try {
            const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
            d.setAuthTag(Buffer.from(parts[2], "base64url"));
            const token = Buffer.concat([d.update(Buffer.from(parts[3], "base64url")), d.final()]).toString("utf8");
            return { token, version: 1, kid: null };
          } catch {
            /* try the next key */
          }
        }
        return null;
      }

      if (parts.length === 5 && parts[0] === LINK_SEAL_PREFIX) {
        if (!binding) return null; // v2 is bound by design; refuse unbound reads
        const key = accepted().find((k) => linkKeyId(k) === parts[1]);
        if (!key) return null;
        const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[2], "base64url"));
        d.setAAD(Buffer.from(binding, "utf8"));
        d.setAuthTag(Buffer.from(parts[3], "base64url"));
        const token = Buffer.concat([d.update(Buffer.from(parts[4], "base64url")), d.final()]).toString("utf8");
        return { token, version: 2, kid: parts[1] };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Back-compat helper: token or null, version discarded. */
  function open(blob, aad) {
    return openDetailed(blob, aad)?.token ?? null;
  }

  return { seal, open, openDetailed, kid, version: LINK_SEAL_VERSION };
}

/** Canonical AAD for a signer row. */
export function signerAad(agreementId, signerId) {
  return `${String(agreementId)}:${String(signerId)}`;
}
