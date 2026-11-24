/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — pure, no dependencies.
 *
 * Patterns are weak secrets; a code from an authenticator app is not. This
 * module also handles sealing the shared secret at rest, so a database dump
 * alone cannot be used to mint codes.
 */
import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input) {
  const s = String(input || "").toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("base32: invalid character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** HOTP over an arbitrary counter (RFC 4226). */
export function hotp(key, counter, digits = 6) {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpCode(secret, { now = Date.now(), period = 30, digits = 6 } = {}) {
  const counter = Math.floor(now / 1000 / period);
  return hotp(base32Decode(secret), counter, digits);
}

/**
 * @returns {{ ok: boolean, step?: number }}
 * window=1 accepts the previous/next 30-second step (clock drift).
 */
export function verifyTotp(secret, code, { now = Date.now(), period = 30, digits = 6, window = 1 } = {}) {
  const input = String(code || "").replace(/\s+/g, "");
  if (!new RegExp("^\\d{" + digits + "}$").test(input)) return { ok: false };
  const current = Math.floor(now / 1000 / period);
  const key = base32Decode(secret);
  for (let delta = -window; delta <= window; delta += 1) {
    const step = current + delta;
    if (step < 0) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, step, digits)), Buffer.from(input))) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

export function otpauthUrl({ issuer = "Agreement", account = "admin", secret, digits = 6, period = 30 }) {
  const label = encodeURIComponent(issuer) + ":" + encodeURIComponent(account);
  const params = new URLSearchParams({ secret, issuer, digits: String(digits), period: String(period) });
  return "otpauth://totp/" + label + "?" + params.toString();
}

/* ── sealing the shared secret ─────────────────────────────────────────── */

/** Derive a 32-byte key from a server-only secret. */
export function totpKey(serverSecret) {
  if (!serverSecret || serverSecret.length < 16) throw new Error("totpKey: server secret is required");
  return crypto.createHash("sha256").update("agreement:totp:" + serverSecret).digest();
}

/** AES-256-GCM; output `v1.<iv>.<tag>.<ct>` with base64url parts. */
export function sealSecret(secret, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function openSecret(blob, key) {
  const [version, ivB, tagB, ctB] = String(blob || "").split(".");
  if (version !== "v1" || !ivB || !tagB || !ctB) throw new Error("sealed secret is malformed");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}
