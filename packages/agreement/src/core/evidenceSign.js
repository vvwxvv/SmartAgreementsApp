/**
 * Server-side evidence signatures (Ed25519).
 *
 * The SHA-256 digests alone prove "this record has not changed since export" —
 * but anyone who can write to the database can recompute them. Signing the two
 * digests with a key that never leaves the server turns them into evidence a
 * third party can verify without trusting the database:
 *
 *   - `signatureHash` per signer (who / when / from where / which text / image)
 *   - `completionHash` per agreement (completedAt, term end, all signatures)
 *
 * Keys are configured through the environment:
 *   AGREEMENT_EVIDENCE_PRIVATE_KEY   PKCS#8 DER/base64, PEM, or a 32-byte seed
 *   AGREEMENT_EVIDENCE_PUBLIC_KEYS   `kid:x,kid:x` for keys kept only to verify
 *
 * `kid` is the first 8 hex of SHA-256 over the raw public key; old signatures
 * stay verifiable as long as their public key is listed.
 */
import crypto from "node:crypto";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function privateKeyFrom(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  try {
    if (text.includes("BEGIN")) return crypto.createPrivateKey({ key: text });
    const seed = Buffer.from(text, "base64url");
    if (seed.length === 32) {
      return crypto.createPrivateKey({
        key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
        format: "der",
        type: "pkcs8",
      });
    }
    return crypto.createPrivateKey({ key: Buffer.from(text, "base64"), format: "der", type: "pkcs8" });
  } catch {
    return null;
  }
}

function jwkX(publicKey) {
  return String(publicKey.export({ format: "jwk" }).x || "");
}

function publicKeyFromX(x) {
  const raw = String(x || "").trim();
  if (!raw) return null;
  try {
    return crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw }, format: "jwk" });
  } catch {
    return null;
  }
}

export function evidenceKeyId(publicKey) {
  const x = jwkX(publicKey);
  return crypto.createHash("sha256").update(Buffer.from(x, "base64url")).digest("hex").slice(0, 8);
}

/**
 * @param {object} [opts]
 * @param {string} [opts.privateKey] seed / PKCS#8 base64 / PEM
 * @param {string|string[]} [opts.publicKeys] `kid:x` entries (verify-only keys)
 */
export function createEvidenceSigner({ privateKey, publicKeys } = {}) {
  const priv = privateKeyFrom(privateKey);
  const pub = priv ? crypto.createPublicKey(priv) : null;
  const kid = pub ? evidenceKeyId(pub) : null;

  const trusted = new Map();
  if (pub && kid) trusted.set(kid, pub);
  const list = Array.isArray(publicKeys) ? publicKeys : String(publicKeys || "").split(",");
  for (const row of list) {
    const text = String(row || "").trim();
    if (!text) continue;
    const at = text.indexOf(":");
    if (at < 1) continue;
    const id = text.slice(0, at).trim();
    const key = publicKeyFromX(text.slice(at + 1));
    if (id && key) trusted.set(id, key);
  }

  const publicKey = pub && kid ? { alg: "ed25519", kid, x: jwkX(pub) } : null;
  const fingerprint = publicKey
    ? crypto.createHash("sha256").update(Buffer.from(publicKey.x, "base64url")).digest("hex")
    : null;

  /** @returns {{alg:'ed25519', kid:string, sig:string}|null} */
  function sign(digest) {
    if (!priv || !kid) return null;
    const message = Buffer.from(String(digest), "utf8");
    const sig = crypto.sign(null, message, priv).toString("base64url");
    return { alg: "ed25519", kid, sig };
  }

  /**
   * @param {string} digest
   * @param {{kid?: string, sig?: string}|null} sealed
   * @returns {'valid'|'invalid'|'unknown-key'|'none'}
   */
  function verify(digest, sealed) {
    const sig = String(sealed?.sig || "");
    if (!sig) return "none";
    const key = trusted.get(String(sealed?.kid || ""));
    if (!key) return "unknown-key";
    try {
      const ok = crypto.verify(
        null,
        Buffer.from(String(digest), "utf8"),
        key,
        Buffer.from(sig, "base64url")
      );
      return ok ? "valid" : "invalid";
    } catch {
      return "invalid";
    }
  }

  return {
    alg: "ed25519",
    enabled: Boolean(priv && kid),
    kid,
    publicKey,
    fingerprint,
    trustedKids: [...trusted.keys()],
    sign,
    verify,
  };
}
