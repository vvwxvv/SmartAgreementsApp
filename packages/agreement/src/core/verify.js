/**
 * Evidence verification, public status lookups and the print/PDF surface.
 * Recomputes everything from stored fields; nothing is trusted as-is.
 */
import { hmac, safeEqual, sha256 } from "./hash.js";
import { computeTermEnd } from "./terms.js";
import { fingerprint, effectiveStatus, buildEvidence, eventHash, evidenceHash, completionSeal, isOid } from "./domain.js";

export function createVerify(ctx) {
  const { getStorage, signSecret, attachments, evidenceSigner } = ctx;

  /**
   * Token → signer + agreement. createSigning has its own copy; this module
   * needs one too (the print-by-token surface lives here). Without it the
   * helper was simply undefined and every /sign/<token>/print request 404'd.
   */
  async function signerByToken(token) {
    if (!token || typeof token !== "string") return null;
    const store = await getStorage();
    const s = await store.findSignerByTokenHash(sha256(token));
    if (!s) return null;
    const a = await store.getAgreement(String(s.agreementId));
    if (!a) return null;
    return { signer: s, agreement: a };
  }

async function verifySignature({ agreementId, signerId, cert }) {
  const store = await getStorage();
  const agreement = await store.getAgreement(agreementId);
  if (!agreement) return { found: false };
  const signer = await store.getSigner(signerId, String(agreement._id));
  if (!signer || !signer.signedAt) return { found: false };

  const rows = await store.listSigners(String(agreement._id));
  // Content binding: recompute the agreement fingerprint and compare it with
  // what was frozen at send time. Without this, editing the body would leave
  // the evidence chain intact and /verify would still say "valid".
  const recomputedContent = agreement.contentHash ? fingerprint(agreement, rows) : null;
  const contentMatch = recomputedContent === null ? null : recomputedContent === agreement.contentHash;

  const expectedTermEnd = computeTermEnd({
    termMonths: agreement.termMonths,
    termEnd: agreement.termEndExplicit ? agreement.termEnd : null,
    effectiveAt: agreement.effectiveAt,
    completedAt: agreement.completedAt,
  });
  const storedTermEndMs = agreement.termEnd ? new Date(agreement.termEnd).getTime() : null;
  const expectedTermEndMs = expectedTermEnd ? new Date(expectedTermEnd).getTime() : null;
  const termEndMatch = storedTermEndMs === expectedTermEndMs;

  // Honest coverage: v1 fingerprints predate the term fields, so a v1 record
  // cannot claim "nothing changed since signing" for them.
  const version = Number(agreement.hashV ?? 1);
  const legacy = version === 1;
  // A v3 record whose signers are all signed must carry the seal; otherwise
  // deleting completionHash would turn "mismatch" into "unsealed, but valid".
  // Tying this to the signer rows avoids trusting status/completedAt, which are
  // exactly what the seal protects.
  const allSigned = rows.length > 0 && rows.every((r) => Boolean(r.signedAt));
  // Any completion signal demands the seal: clearing one signer's signedAt must
  // not turn a COMPLETED record back into "still signing, seal not applicable".
  const markedCompleted = String(agreement.status || "").toUpperCase() === "COMPLETED";
  const requiresSeal =
    version >= 3 && (markedCompleted || agreement.completedAt != null || allSigned);
  const completionMatch = agreement.completionHash
    ? completionSeal({
        agreementId: String(agreement._id),
        number: agreement.number,
        contentHash: agreement.contentHash,
        completedAt: agreement.completedAt,
        termEnd: agreement.termEnd,
        signers: rows,
      }) === agreement.completionHash
    : requiresSeal
      ? false
      : null;

  const evidence = buildEvidence({
    agreement,
    signer,
    contentHash: signer.contentHash,
    signedAt: signer.signedAt,
    ip: signer.signedIp,
    uaHash: signer.uaHash,
    imageSha256: signer.signatureImage ? sha256(signer.signatureImage) : null,
  });
  const computed = evidenceHash(evidence);
  const match = computed === signer.signatureHash;
  const certOk = cert ? cert.toUpperCase() === `CERT-${computed.slice(0, 16).toUpperCase()}` : false;

  // Server signature over the stored digest. Verified with the public key, so
  // it is independent of database access; an old key can still verify via the
  // configured previous-public-key list.
  const sigStatus = evidenceSigner.verify(
    signer.signatureHash,
    signer.signatureSig ? { kid: signer.signatureKeyId, sig: signer.signatureSig } : null
  );
  const completionSigStatus = agreement.completionHash
    ? evidenceSigner.verify(
        agreement.completionHash,
        agreement.completionSig ? { kid: agreement.completionKeyId, sig: agreement.completionSig } : null
      )
    : "none";

  return {
    found: true,
    match,
    contentMatch,
    termEndMatch,
    verified:
      match &&
      contentMatch !== false &&
      termEndMatch &&
      completionMatch !== false &&
      sigStatus !== "invalid" &&
      completionSigStatus !== "invalid",
    evidenceSignature: {
      alg: "ed25519",
      status: sigStatus,
      kid: signer.signatureKeyId || null,
      currentKid: evidenceSigner.kid || null,
      configured: Boolean(evidenceSigner.enabled),
    },
    completionSignature: {
      alg: "ed25519",
      status: completionSigStatus,
      kid: agreement.completionKeyId || null,
    },
    evidenceKey: evidenceSigner.publicKey
      ? { ...evidenceSigner.publicKey, fingerprint: evidenceSigner.fingerprint }
      : null,
    eventChain: await verifyEventChain(agreement._id),
    legacy,
    hashV: agreement.hashV ?? 1,
    completionMatch,
    completionSealed: Boolean(agreement.completionHash),
    requiresSeal,
    certOk,
    evidence,
    computed,
    stored: signer.signatureHash,
    agreementNumber: agreement.number,
    agreementStatus: effectiveStatus(agreement),
    title: agreement.title,
    tsa: signer.tsaToken ? { url: signer.tsaUrl, time: signer.tsaTime } : null,
  };
}

/** Walk the audit trail and prove it is an unbroken chain.
 *  Events written before this feature have no hash: they are reported as a
 *  legacy prefix, not as tampering. */
async function verifyEventChain(agreementId) {
  const store = await getStorage();
  const rows = await store.listEvents(String(agreementId), 10000);
  const legacyRows = rows.filter((ev) => !ev.hash);
  const hashed = rows.filter((ev) => ev.hash);
  const result = (extra) => ({
    ok: false,
    complete: false,
    count: rows.length,
    hashed: 0,
    legacy: legacyRows.length,
    ...extra,
  });

  if (!hashed.length) {
    return { ok: true, complete: false, count: rows.length, hashed: 0, legacy: legacyRows.length };
  }

  // Order by the chain itself, not by timestamps: two events can share the same
  // millisecond, and a reversed tie order would look like tampering.
  const children = new Map();
  for (const ev of hashed) {
    const key = ev.prevHash == null ? "__root__" : String(ev.prevHash);
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(ev);
  }
  const roots = children.get("__root__") || [];
  // Multiple roots = fork. A single root is normal; a legacy prefix simply has
  // no hashed events before it, so the first hashed event also points to null.
  if (roots.length !== 1) return result({ reason: roots.length === 0 ? "link" : "fork", brokenAt: null });

  const visited = new Set();
  let current = roots[0];
  let prev = null;
  let checked = 0;
  while (current) {
    if ((current.prevHash || null) !== prev) return result({ reason: "link", brokenAt: checked, hashed: checked });
    const expected = eventHash({
      agreementId: String(current.agreementId),
      signerId: current.signerId ? String(current.signerId) : null,
      type: current.type,
      at: current.at,
      ipHash: current.ipHash || null,
      meta: current.meta ?? null,
      prevHash: current.prevHash || null,
    });
    if (expected !== current.hash) return result({ reason: "hash", brokenAt: checked, hashed: checked });
    visited.add(String(current.hash));
    prev = String(current.hash);
    checked += 1;
    current = (children.get(prev) || []).find((ev) => !visited.has(String(ev.hash))) || null;
  }
  if (checked !== hashed.length) {
    // A dangling prevHash means an event was deleted; two events claiming the
    // same predecessor means the chain forked.
    const dangling = hashed.some((ev) => ev.prevHash && !hashed.some((other) => other.hash === ev.prevHash));
    return result({ reason: dangling ? "link" : "fork", brokenAt: checked, hashed: checked });
  }
  return {
    ok: true,
    complete: legacyRows.length === 0,
    count: rows.length,
    hashed: checked,
    legacy: legacyRows.length,
  };
}

async function getStatus(id) {
  const store = await getStorage();
  if (!isOid(id)) return null;
  const a = await store.getAgreement(id);
  if (!a) return null;
  const rows = await store.listSigners(id);
  return {
    id: String(a._id),
    number: a.number,
    status: effectiveStatus(a),
    createdAt: a.createdAt,
    sentAt: a.sentAt,
    completedAt: a.completedAt,
    contentHash: a.contentHash,
    events: await verifyEventChain(a._id),
    signers: rows.map((s) => ({
      email: s.email,
      label: s.label,
      signed: Boolean(s.signedAt),
      signedAt: s.signedAt,
    })),
  };
}

const PRINT_KEY_TTL_MS = 10 * 60 * 1000;
const PRINT_KEY_SKEW_MS = 60 * 1000;

function printKey(id, now = Date.now()) {
  const exp = Math.floor(now + PRINT_KEY_TTL_MS);
  return `${exp}.${hmac(`print:${id}:${exp}`, signSecret())}`;
}

function checkPrintKey(id, key) {
  const raw = String(key || "");
  const dot = raw.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(raw.slice(0, dot));
  if (!Number.isFinite(exp)) return false;
  const now = Date.now();
  if (exp < now) return false;
  // A correctly signed key should never be far in the future; bounding it stops
  // a leaked key from being replayed indefinitely.
  if (exp > now + PRINT_KEY_TTL_MS + PRINT_KEY_SKEW_MS) return false;
  return safeEqual(raw.slice(dot + 1), hmac(`print:${id}:${exp}`, signSecret()));
}

async function getPrintableByToken(token) {
  const hit = await signerByToken(token);
  if (!hit) return null;
  return printable(hit.agreement);
}

async function getPrintableById(id) {
  if (!isOid(id)) return null;
  const store = await getStorage();
  const a = await store.getAgreement(id);
  return a ? printable(a) : null;
}

async function printable(a) {
  const store = await getStorage();
  const rows = await store.listSigners(String(a._id));
  return {
    agreement: {
      id: String(a._id),
      number: a.number,
      title: a.title,
      category: a.category || null,
      body: a.body,
      consentText: a.consentText,
      titleEn: a.titleEn || null,
      bodyEn: a.bodyEn || null,
      consentTextEn: a.consentTextEn || null,
      lang: a.lang || "zh",
      status: effectiveStatus(a),
      sentAt: a.sentAt,
      completedAt: a.completedAt,
      expiresAt: a.expiresAt,
      contentHash: a.contentHash,
    },
    attachments: await attachments.list(String(a._id)),
    signers: rows.map((s) => ({
      id: String(s._id),
      email: s.email,
      label: s.label,
      signedName: s.signedName,
      signedAt: s.signedAt,
      signed: Boolean(s.signedAt),
      signedIp: s.signedIp || null,
      signatureHash: s.signatureHash || null,
      tsaUrl: s.tsaUrl || null,
      tsaTime: s.tsaTime || null,
      // Raw RFC 3161 token (base64). Used by the evidence package; the print
      // page only renders tsaUrl/tsaTime.
      tsaToken: s.tsaToken || null,
      image: s.signatureImage ? `data:image/png;base64,${s.signatureImage}` : null,
    })),
  };
}

async function verifyByCert(number, cert) {
  const store = await getStorage();
  const a = await store.findAgreementByNumber(number);
  if (!a) return { found: false };
  const rows = await store.listSigners(String(a._id));
  const code = String(cert || "").replace(/^CERT-?/i, "").trim().toUpperCase();
  if (!code) return { found: false };
  const hit = rows.find((r) => r.signatureHash && r.signatureHash.toUpperCase().startsWith(code));
  if (!hit) return { found: false };
  return verifySignature({ agreementId: String(a._id), signerId: String(hit._id), cert: `CERT-${code}` });
}

async function verifyByNumber(number) {
  const store = await getStorage();
  const a = await store.findAgreementByNumber(number);
  if (!a) return null;
  return getStatus(String(a._id));
}

  return { verifySignature, verifyEventChain, verifyByCert, verifyByNumber, getStatus, printKey, checkPrintKey, getPrintableByToken, getPrintableById, printable };
}
