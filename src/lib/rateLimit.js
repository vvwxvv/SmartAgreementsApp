/**
 * Tiny in-process rate limiter for public write/verify endpoints.
 *
 * Scope is deliberately small: a fixed window per key (IP, or IP + token).
 * This is the same trade-off as the admin gate throttle — good enough to stop
 * scripted guessing from one source, not a replacement for a gateway limit
 * when the app runs multiple instances.
 *
 * Tests set RATE_LIMIT_DISABLED=1 so they never trip over each other.
 */

import { inc } from "./observability.js";

const buckets = new Map();
const MAX_BUCKETS = 20000;

function sweep(now) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, row] of buckets) {
    if (now - row.start >= row.windowMs) buckets.delete(key);
  }
  // Still full: drop the oldest half rather than grow without bound.
  if (buckets.size >= MAX_BUCKETS) {
    const keys = [...buckets.keys()].slice(0, Math.floor(MAX_BUCKETS / 2));
    for (const key of keys) buckets.delete(key);
  }
}

/**
 * @returns {{ ok: true, remaining: number } | { ok: false, retryAfter: number }}
 */
export function rateLimit({ key, limit = 60, windowMs = 60_000 } = {}) {
  if (String(process.env.RATE_LIMIT_DISABLED || "") === "1") return { ok: true, remaining: limit };
  const now = Date.now();
  sweep(now);
  const row = buckets.get(key);
  if (!row || now - row.start >= windowMs) {
    buckets.set(key, { start: now, n: 1, windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  row.n += 1;
  if (row.n > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((row.start + windowMs - now) / 1000)) };
  }
  return { ok: true, remaining: limit - row.n };
}

/** Test/ops hook: forget every bucket. */
export function resetRateLimits() {
  buckets.clear();
}

/** Best-effort client address, same rule the sign route uses for signedIp. */
export function clientIp(request) {
  const fwd = request?.headers?.get?.("x-forwarded-for");
  if (fwd) return String(fwd).split(",")[0].trim() || "local";
  return String(request?.headers?.get?.("x-real-ip") || "local");
}

export function tooManyResponse(retryAfter) {
  inc("rate_limited");
  return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}
