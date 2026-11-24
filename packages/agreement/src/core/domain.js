/**
 * Pure domain rules shared by the signing/verification modules.
 * No I/O, no storage, no clock except the optional `now` arguments.
 */
import { canonicalJSON, sha256 } from "./hash.js";

const MAX_IMAGE_BYTES = 300 * 1024;
const DRAFT_LIMITS = Object.freeze({
  title: 300,
  body: 200_000,
  consentText: 4_000,
  signers: 20,
});

const PARTY_FIELDS = [
  "kind", "name", "nameEn", "contactPerson", "legalRepresentative",
  "email", "phone", "wechat", "address", "addressEn", "postalCode",
  "note", "isSelf", "lang",
];

const PARTY_LIMITS = {
  kind: 20, name: 120, nameEn: 120, contactPerson: 120, legalRepresentative: 120,
  email: 254, phone: 40, wechat: 64, address: 500, addressEn: 500,
  postalCode: 20, note: 1000, lang: 5,
};

function cleanPartyInput(input = {}, { requireName = false } = {}) {
  const out = {};
  for (const key of PARTY_FIELDS) {
    if (input[key] === undefined) continue;
    if (key === "isSelf") { out.isSelf = input.isSelf === true; continue; }
    const raw = input[key];
    if (typeof raw !== "string") throw new Error(key + " 必须是字符串");
    const value = raw.trim();
    const max = PARTY_LIMITS[key];
    if (max && value.length > max) throw new Error(key + " 过长（最多 " + max + " 字符）");
    if (key === "email" && value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new Error("邮箱格式不正确");
    out[key] = value || null;
  }
  if (requireName && !out.name) throw new Error("名称不能为空");
  return out;
}
const isOid = (id) => /^[a-f\d]{24}$/i.test(String(id || ""));

function compareSigners(a, b) {
  const ka = [a.order ?? 0, a.email || "", String(a._id || "")];
  const kb = [b.order ?? 0, b.email || "", String(b._id || "")];
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

function fingerprintInput(agreement, signers) {
  const list = signers
    .slice()
    .sort(compareSigners)
    .map((s) => ({ email: s.email, label: s.label || null, order: s.order ?? 0 }));
  if ((agreement.hashV ?? 1) === 1) {
    const deadline = agreement.signDeadline || agreement.expiresAt;
    return {
      title: agreement.title,
      body: agreement.body,
      consentText: agreement.consentText,
      expiresAt: deadline ? new Date(deadline).toISOString() : null,
      signers: list,
    };
  }
  const body = {
    title: agreement.title,
    body: agreement.body,
    consentText: agreement.consentText,
    termMonths: agreement.termMonths ?? null,
    termEndExplicit: agreement.termEndExplicit === true,
    termEnd: agreement.termEndExplicit && agreement.termEnd ? new Date(agreement.termEnd).toISOString() : null,
    effectiveMode: agreement.effectiveMode || "completion",
    effectiveAt: agreement.effectiveAt ? new Date(agreement.effectiveAt).toISOString() : null,
    signers: list,
  };
  // v4 also binds attachments (name/size/digest). They change what the signer
  // receives, so they must change the fingerprint; the bytes themselves live in
  // a separate collection and are verified by their own SHA-256.
  const version = Number(agreement.hashV ?? 1);
  if (version >= 4) {
    const attachments = (agreement.attachments || [])
      .map((a) => ({ name: a.name || null, size: a.size ?? null, sha256: a.sha256 || null }))
      .sort((x, y) => String(x.name).localeCompare(String(y.name)) || String(x.sha256).localeCompare(String(y.sha256)));
    return { v: 4, sealRequired: true, ...body, attachments };
  }
  // v3 binds the completion-seal requirement into the content hash itself, so
  // deleting completionHash cannot downgrade a completed record to "unsealed".
  if (version >= 3) return { v: 3, sealRequired: true, ...body };
  return { v: 2, ...body };
}

function fingerprint(agreement, signers) {
  return sha256(canonicalJSON(fingerprintInput(agreement, signers)));
}

function agreementYear(now = new Date()) {
  // Contract years follow the business timezone, not the server's.
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric" }).formatToParts(now);
    const y = parts.find((p) => p.type === "year");
    if (y) return Number(y.value);
  } catch {
    /* fall through */
  }
  return now.getUTCFullYear();
}

function effectiveStatus(a) {
  const deadline = a.signDeadline || a.expiresAt;
  if (a.status === "SENT" && deadline && new Date(deadline).getTime() < Date.now()) return "EXPIRED";
  return a.status;
}

function publicSigner(s) {
  return {
    id: String(s._id),
    email: s.email,
    label: s.label,
    order: s.order,
    signed: Boolean(s.signedAt),
    signedName: s.signedName,
    signedAt: s.signedAt,
    signedIp: s.signedIp || null,
    signatureHash: s.signatureHash || null,
    emailVerified: Boolean(s.emailVerifiedAt),
    hasLink: Boolean(s.accessTokenHash),
    declined: Boolean(s.declinedAt),
    declinedAt: s.declinedAt || null,
    declineReason: s.declineReason || null,
  };
}

function buildEvidence({ agreement, signer, contentHash, signedAt, ip, uaHash, imageSha256 }) {
  return {
    v: 1,
    agreement: {
      id: String(agreement._id),
      number: agreement.number,
      title: agreement.title,
      contentSha256: contentHash,
    },
    signer: {
      id: String(signer._id),
      label: signer.label || null,
      email: signer.email,
    },
    signedAt: new Date(signedAt).toISOString(),
    ip: ip || null,
    userAgentSha256: uaHash || null,
    signatureImageSha256: imageSha256 || null,
  };
}

function eventHash({ agreementId, signerId, type, at, ipHash, meta, prevHash }) {
  return sha256(
    canonicalJSON({
      v: 1,
      agreementId: String(agreementId),
      signerId: signerId ? String(signerId) : null,
      type: String(type),
      at: at ? new Date(at).toISOString() : null,
      ipHash: ipHash || null,
      meta: meta == null ? null : String(meta),
      prevHash: prevHash || null,
    })
  );
}

function evidenceHash(evidence) {
  return sha256(canonicalJSON(evidence));
}

function completionSeal({ agreementId, number, contentHash, completedAt, termEnd, signers }) {
  const list = (signers || [])
    .slice()
    .sort(compareSigners)
    .map((s) => ({
      email: s.email || null,
      label: s.label || null,
      signedAt: s.signedAt ? new Date(s.signedAt).toISOString() : null,
      signatureHash: s.signatureHash || null,
    }));
  return sha256(
    canonicalJSON({
      v: 1,
      agreementId: String(agreementId),
      number: number || null,
      contentHash: contentHash || null,
      completedAt: completedAt ? new Date(completedAt).toISOString() : null,
      termEnd: termEnd ? new Date(termEnd).toISOString() : null,
      signers: list,
    })
  );
}

export {
  DRAFT_LIMITS,
  PARTY_FIELDS,
  PARTY_LIMITS,
  cleanPartyInput,
  isOid,
  compareSigners,
  fingerprintInput,
  fingerprint,
  agreementYear,
  effectiveStatus,
  publicSigner,
  buildEvidence,
  eventHash,
  evidenceHash,
  completionSeal,
};
