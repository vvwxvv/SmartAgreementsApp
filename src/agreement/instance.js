/**
 * Host wiring for the packaged core.
 *
 * This file is the only place that knows about Mongo ids, environment
 * variables and the local Chromium build. Everything below it is portable.
 */
import { ObjectId } from "mongodb";
import { getDb } from "@/app/api/_lib/mongo";
import { createAgreementService, createStorage, createPdfRenderer, timestampDigest, createEvidenceSigner } from "../../packages/agreement/src/core/index.js";
import { inc } from "@/lib/observability";

let storagePromise = null;

/** One adapter per process; getDb() itself is cached. */
function storage() {
  if (!storagePromise) {
    storagePromise = getDb().then((db) => createStorage(db, { ObjectId }));
  }
  return storagePromise;
}

/** Old behaviour kept verbatim: explicit env wins, otherwise derive from Host. */
export function baseUrl(req) {
  const env = String(process.env.AGREEMENT_BASE_URL || "").trim();

  // A real public origin wins. A localhost env value is a dev leftover and must
  // not override the port the site actually runs on.
  if (env && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(env)) {
    return env.replace(/\/$/, "");
  }
  const host =
    req?.headers?.get?.("x-forwarded-host") ||
    req?.headers?.get?.("host") ||
    "";
  if (host) {
    const proto =
      req?.headers?.get?.("x-forwarded-proto") ||
      (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  if (env) return env.replace(/\/$/, "");
  return "http://localhost:3000";
}

const signSecret = () => process.env.JWT_SECRET || process.env.AGREEMENT_SECRET || "dev-only-secret-change-me";

/**
 * Non-production fallback to JWT_SECRET is kept so existing ciphertext stays
 * readable. Production requires a dedicated AGREEMENT_LINK_KEY.
 */
const linkKey = () => {
  const dedicated = process.env.AGREEMENT_LINK_KEY;
  const fallback =
    process.env.NODE_ENV === "production" ? "" : process.env.JWT_SECRET || process.env.AGREEMENT_SECRET || "";
  return dedicated || fallback || "";
};

// TSA is best-effort; count outcomes so a broken third-party service shows up
// in /api/metrics instead of only inside a signed PDF.
const instrumentedTsa = async (digest) => {
  const result = await timestampDigest(digest).catch(() => ({ ok: false }));
  inc(result.ok ? "tsa_ok" : "tsa_fail");
  return result;
};

/** Ed25519 key for server-side evidence signatures. Verification-only keys can
 *  be listed separately so old signatures stay checkable after a rotation. */
export const evidenceSigner = createEvidenceSigner({
  privateKey: process.env.AGREEMENT_EVIDENCE_PRIVATE_KEY || "",
  publicKeys: process.env.AGREEMENT_EVIDENCE_PUBLIC_KEYS || "",
});

/** Retired link keys kept readable during a rotation window (comma list). */
const previousLinkKeys = () => String(process.env.AGREEMENT_LINK_KEYS_PREVIOUS || "");

export const service = createAgreementService({
  storage,
  baseUrl,
  secrets: { signSecret, linkKey, previousLinkKeys },
  tsa: instrumentedTsa,
  evidenceSigner,
});

export const {
  nextNumber,
  createDraft,
  updateDraft,
  patchDraft,
  listAgreements,
  effectiveStatus,
  getAgreementDetail,
  extendAgreement,
  setTermAgreement,
  renewAgreement,
  sendAgreement,
  getLinks,
  rotateLink,
  voidAgreement,
  getSignerView,
  buildEvidence,
  evidenceHash,
  verifySignature,
  verifyEventChain,
  signerCookie,
  verifySignerCookie,
  signAgreement,
  declineAgreement,
  getStatus,
  printKey,
  checkPrintKey,
  getPrintableByToken,
  getPrintableById,
  verifyByCert,
  verifyByNumber,
  listPartyInfos,
  getPartyInfo,
  createPartyInfo,
  updatePartyInfo,
  archivePartyInfo,
  addAttachment,
  removeAttachment,
  listAttachments,
  getAttachmentBlob,
  listAttachmentBlobs,
  getSignerAttachment,
} = service;

export const renderAgreementPdf = createPdfRenderer({ baseUrl, printKey });
