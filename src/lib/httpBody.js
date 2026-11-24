/**
 * JSON body reading with an explicit byte ceiling.
 *
 * Route handlers in this app take small JSON documents (a contract, a
 * signature image). Two protections:
 *   1. Content-Length is checked first (cheap rejection).
 *   2. The stream itself is read chunk by chunk and aborted as soon as the real
 *      byte count crosses the limit — a missing or lying Content-Length (chunked
 *      upload) cannot make the process buffer an unbounded body.
 */
const tooLarge = () => {
  const err = new Error("请求体过大");
  err.status = 413;
  return err;
};

async function readStreamCapped(request, maxBytes) {
  const body = request.body;
  if (!body || typeof body.getReader !== "function") {
    // Test doubles and non-stream requests fall back to text().
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > maxBytes) throw tooLarge();
    return raw;
  }
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* already closed */ }
        throw tooLarge();
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock?.(); } catch { /* released */ }
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonLimited(request, maxBytes) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) throw tooLarge();

  const raw = await readStreamCapped(request, maxBytes);
  if (Buffer.byteLength(raw, "utf8") > maxBytes) throw tooLarge();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("请求体不是合法 JSON");
    err.status = 400;
    throw err;
  }
}

export const LIMITS = Object.freeze({
  draftBytes: 256 * 1024, // one contract: title + markdown body + consent
  signBytes: 640 * 1024, // signature data URL is capped at 300 KB of PNG
  partyBytes: 64 * 1024,
});
