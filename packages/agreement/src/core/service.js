/**
 * Agreement service — composition root.
 *
 * The business rules live in focused modules (drafts / signing / verify /
 * renewal / parties). This file only wires them to one storage adapter, one
 * set of secrets and the per-process agreement lock, so a process can host
 * several configurations (tests, tenants) without module-level state.
 */
import crypto from "node:crypto";
import { timestampDigest as defaultTsa } from "./tsa.js";
import { buildEvidence, effectiveStatus, eventHash, evidenceHash, fingerprint, publicSigner } from "./domain.js";
import { createDrafts } from "./drafts.js";
import { createSigning } from "./signing.js";
import { createVerify } from "./verify.js";
import { createRenewal } from "./renewal.js";
import { createParties } from "./parties.js";
import { createAttachments } from "./attachments.js";
import { createLinkSealer, signerAad } from "./linkSeal.js";
import { createEvidenceSigner } from "./evidenceSign.js";

/**
 * @param {object} deps
 * @param {() => Promise<object>} deps.storage  returns the storage adapter
 * @param {string|((req:any)=>string)} deps.baseUrl  absolute site origin
 * @param {{ signSecret: string, linkKey: string }} deps.secrets
 * @param {(digest: string) => Promise<object>} [deps.tsa] optional timestamping
 */
export function createAgreementService({ storage, baseUrl, secrets, tsa = defaultTsa, serialize = true, evidenceSigner = null } = {}) {
  if (typeof storage !== "function") throw new Error("createAgreementService: storage() is required");
  if (typeof baseUrl !== "string" && typeof baseUrl !== "function") throw new Error("createAgreementService: baseUrl is required");
  if (!secrets || !secrets.signSecret) throw new Error("createAgreementService: secrets.signSecret is required");

  const getStorage = () => storage();
  const readSecret = (v) => (typeof v === "function" ? v() : v);
  const signSecret = () => String(readSecret(secrets.signSecret));

  // Serialize void/sign per agreement inside this process. Multi-instance
  // Mongo is covered by the post-commit status check in signing.js.
  const agreementLocks = new Map();
  function withAgreementLock(id, fn) {
    if (!serialize) return fn();
    const key = String(id);
    const prev = agreementLocks.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    agreementLocks.set(key, tail);
    tail.then(() => { if (agreementLocks.get(key) === tail) agreementLocks.delete(key); });
    return run;
  }

  // Audit events form a hash chain. They are appended from inside the signing
  // lock as well, so use a separate per-agreement queue: taking the same lock
  // twice would deadlock, and two events written concurrently would fork.
  const eventLocks = new Map();
  function withEventLock(id, fn) {
    if (!serialize) return fn();
    const key = String(id);
    const prev = eventLocks.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    eventLocks.set(key, tail);
    tail.then(() => { if (eventLocks.get(key) === tail) eventLocks.delete(key); });
    return run;
  }

  /** Append one audit event, linking it to the current head of the chain. */
  async function appendEvent(evt) {
    const agreementId = String(evt.agreementId);
    return withEventLock(agreementId, async () => {
      const store = await getStorage();
      const [last] = await store.listEvents(agreementId, 1);
      const prevHash = last && last.hash ? String(last.hash) : null;
      const at = evt.at ? new Date(evt.at) : new Date();
      // Hash exactly what the adapter stores: meta is truncated to 500 chars.
      const meta = evt.meta == null ? null : String(evt.meta).slice(0, 500);
      const signerId = evt.signerId ? String(evt.signerId) : null;
      const ipHash = evt.ipHash || null;
      const hash = eventHash({ agreementId, signerId, type: evt.type, at, ipHash, meta, prevHash });
      await store.appendEvent({ ...evt, signerId, at, ipHash, meta, prevHash, hash });
      return { hash, prevHash, at };
    });
  }

  const siteUrl = (req) => {
    const raw = typeof baseUrl === "function" ? baseUrl(req) : baseUrl;
    return String(raw || "").replace(/\/$/, "");
  };

  /** Invite tokens are bearer credentials: anyone holding the link can sign.
   *  Keep them encrypted at rest with a key that lives in the environment, not
   *  in the database. The hash column stays for fast lookup. v2 also binds each
   *  blob to its agreement+signer (AAD) and tags the key id for rotation. */
  const linkSealer = createLinkSealer({
    currentKey: () => readSecret(secrets.linkKey),
    previousKeys: () => readSecret(secrets.previousLinkKeys) || "",
  });

  const sealToken = (token, aad) => linkSealer.seal(token, aad);
  const openToken = (blob, aad) => linkSealer.open(blob, aad);
  const openTokenDetailed = (blob, aad) => linkSealer.openDetailed(blob, aad);

  const attachments = createAttachments({ getStorage });
  const signer = evidenceSigner || createEvidenceSigner({});
  const ctx = {
    getStorage,
    siteUrl,
    signSecret,
    withAgreementLock,
    sealToken,
    openToken,
    openTokenDetailed,
    signerAad,
    tsa,
    attachments,
    evidenceSigner: signer,
    appendEvent,
  };

  const drafts = createDrafts(ctx);
  const signing = createSigning(ctx);
  const verify = createVerify(ctx);
  const parties = createParties(ctx);
  const renewal = createRenewal(ctx, { createDraft: drafts.createDraft });

  return {
    fingerprint,
    effectiveStatus,
    publicSigner,
    buildEvidence,
    evidenceHash,
    ...drafts,
    ...signing,
    ...verify,
    ...parties,
    ...renewal,
    addAttachment: attachments.add,
    removeAttachment: attachments.remove,
    listAttachments: attachments.list,
    getAttachmentBlob: attachments.getBlob,
    listAttachmentBlobs: attachments.listBlobs,
    getSignerAttachment: attachments.getForSigner,
  };
}
