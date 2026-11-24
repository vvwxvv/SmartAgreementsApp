/**
 * Small, dependency-free observability layer.
 *
 * - One JSON line per event on stdout (journald / pm2 / docker logs can index it).
 * - In-process counters for the three numbers that actually matter here:
 *   signing success, PDF failures, TSA failures (plus rate limiting and errors).
 * - Fields are redacted by name so a token or signature image never reaches a log.
 *
 * This is not a replacement for a metrics backend; it is the minimum an operator
 * needs to answer "is it working right now?" without guessing.
 */

const COUNTERS = {
  sign_ok: 0,
  sign_fail: 0,
  decline_ok: 0,
  decline_fail: 0,
  pdf_ok: 0,
  pdf_fail: 0,
  tsa_ok: 0,
  tsa_fail: 0,
  gate_ok: 0,
  gate_fail: 0,
  verify_ok: 0,
  verify_fail: 0,
  rate_limited: 0,
  api_error: 0,
};

const SECRET_KEY = /token|cookie|authorization|password|secret|signatureimage|image|body/i;

export function inc(name, by = 1) {
  if (Object.prototype.hasOwnProperty.call(COUNTERS, name)) COUNTERS[name] += by;
}

export function metricsSnapshot() {
  return { at: new Date().toISOString(), uptime: Math.round(process.uptime()), counters: { ...COUNTERS } };
}

/** Test/ops hook: zero every counter. */
export function resetMetrics() {
  for (const key of Object.keys(COUNTERS)) COUNTERS[key] = 0;
}

/** Drop values whose key looks secret. Keeps the shape useful for logs. */
export function redactFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEY.test(key)) {
      out[key] = "[redacted]";
    } else if (typeof value === "string" && value.length > 200) {
      out[key] = value.slice(0, 200) + "…";
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function logEvent(event, fields = {}, level = "info") {
  const line = { ts: new Date().toISOString(), level, event, ...redactFields(fields) };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else console.log(text);
}

/** Request id from the proxy, or a fresh one for direct calls (tests). */
export function requestIdOf(request) {
  const value = request?.headers?.get?.("x-request-id");
  return value && /^[A-Za-z0-9._-]{8,64}$/.test(value) ? value : "local";
}
