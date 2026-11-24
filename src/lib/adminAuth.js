// Edge-safe admin session helpers (Web Crypto only — this runs in middleware).

const COOKIE = "agreement_admin";

/**
 * Session policy (2026-11-23):
 *
 *   default  → the cookie is a *session* cookie: closing the browser ends the
 *              admin session, so the next visit asks for the two gestures again.
 *   remember → optional, explicit checkbox: 7 days, still capped by the token's
 *              own expiry so a copied cookie cannot live forever.
 *
 * The token version was bumped so any 7-day cookie issued by older builds is
 * rejected; operators re-authenticate once after upgrading.
 */
const TOKEN_VERSION = "v2";
const DEFAULT_SESSION_HOURS = 12;
const DEFAULT_REMEMBER_DAYS = 7;
const MAX_EXP_SECONDS = 30 * 24 * 60 * 60;

function envPositive(name, fallback, env = process.env) {
  const raw = Number(env?.[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Absolute lifetime of one admin session (browser-session cookie). */
export function sessionTtlSeconds(env = process.env) {
  const hours = envPositive("ADMIN_SESSION_HOURS", DEFAULT_SESSION_HOURS, env);
  return Math.min(Math.round(hours * 3600), MAX_EXP_SECONDS);
}

/** Lifetime when the operator ticks "remember this device". */
export function rememberTtlSeconds(env = process.env) {
  const days = envPositive("ADMIN_REMEMBER_DAYS", DEFAULT_REMEMBER_DAYS, env);
  return Math.min(Math.round(days * 86400), MAX_EXP_SECONDS);
}

function b64url(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function secret() {
  // Dedicated admin secret: rotating it logs every admin browser out without
  // touching signer links or PDF print keys.
  return process.env.ADMIN_SESSION_SECRET || process.env.JWT_SECRET || process.env.AGREEMENT_SECRET || "";
}

async function sign(value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return b64url(sig);
}

export async function createAdminToken({ remember = false, now = Date.now(), env = process.env } = {}) {
  const ttl = remember ? rememberTtlSeconds(env) : sessionTtlSeconds(env);
  const exp = Math.floor(now / 1000) + ttl;
  const payload = `${TOKEN_VERSION}.${exp}`;
  return `${payload}.${await sign(`admin:${payload}`)}`;
}

export async function verifyAdminToken(token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = await sign(`admin:${parts[0]}.${parts[1]}`);
  return timingSafeEqual(expected, parts[2]);
}

/** Cookie options shared by unlock (set) and logout (clear). */
export function adminCookieOptions(secure) {
  return { httpOnly: true, sameSite: "lax", secure: Boolean(secure), path: "/" };
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export { COOKIE, TOKEN_VERSION, MAX_EXP_SECONDS };
