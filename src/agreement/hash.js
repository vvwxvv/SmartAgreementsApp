import crypto from "node:crypto";

/** Stable JSON: sorted keys, no whitespace. The content fingerprint must not
 *  change because two objects were built in a different order. */
export function canonicalJSON(value) {
  const walk = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    return Object.keys(v)
      .sort()
      .reduce((acc, k) => {
        if (v[k] !== undefined) acc[k] = walk(v[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(walk(value));
}

export function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

export function hmac(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
