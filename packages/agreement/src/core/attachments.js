/**
 * Attachments: the annexes a real contract carries (quotes, drawings, scans).
 *
 * - Stored one document per file in `AgreementAttachment` (base64 payload), so a
 *   single 5 MB file never approaches MongoDB's 16 MB document limit.
 * - Metadata {id,name,mime,size,sha256} is copied onto the agreement and enters
 *   the v4 content fingerprint, so swapping a file after sending is detectable.
 * - Only DRAFT contracts can add/remove: after `send` the signed content is frozen.
 */
import crypto from "node:crypto";
import { effectiveStatus } from "./domain.js";

export const ATTACHMENT_LIMITS = Object.freeze({
  maxFiles: 5,
  maxEach: 5 * 1024 * 1024,
  maxTotal: 15 * 1024 * 1024,
  nameLength: 120,
});

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function fail(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function cleanName(raw) {
  const name = String(raw || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!name) return "";
  return name.slice(0, ATTACHMENT_LIMITS.nameLength);
}

export function publicAttachment(a) {
  return {
    id: String(a._id),
    name: a.name,
    mime: a.mime,
    size: a.size,
    sha256: a.sha256,
    createdAt: a.createdAt || null,
  };
}

export function createAttachments(ctx) {
  const { getStorage } = ctx;

  async function add(agreementId, { name, mime, data } = {}) {
    const store = await getStorage();
    const agreement = await store.getAgreement(agreementId);
    if (!agreement) throw fail("合同不存在", 404);
    if (effectiveStatus(agreement) !== "DRAFT") throw fail("只有草稿可以添加附件（已发出的合同内容已冻结）", 409);

    const clean = cleanName(name);
    if (!clean) throw fail("附件名不能为空", 400);
    if (!ALLOWED_MIME.has(String(mime || ""))) throw fail("不支持的附件类型", 415);

    let buf;
    try {
      buf = Buffer.from(String(data || ""), "base64");
    } catch {
      throw fail("附件内容不是合法 base64", 400);
    }
    if (!buf.length) throw fail("附件是空的", 400);
    if (buf.length > ATTACHMENT_LIMITS.maxEach) throw fail("单个附件不能超过 5 MB", 413);

    const existing = await store.listAttachments(agreementId);
    if (existing.length >= ATTACHMENT_LIMITS.maxFiles) throw fail("最多 5 个附件", 409);
    const total = existing.reduce((n, x) => n + (Number(x.size) || 0), 0) + buf.length;
    if (total > ATTACHMENT_LIMITS.maxTotal) throw fail("附件总大小不能超过 15 MB", 413);

    const doc = {
      _id: store.newId(),
      name: clean,
      mime: String(mime),
      size: buf.length,
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      data: buf.toString("base64"),
      createdAt: new Date(),
    };
    await store.insertAttachment(agreementId, doc);

    const meta = [...existing, doc]
      .map((x) => ({ id: String(x._id), name: x.name, mime: x.mime, size: x.size, sha256: x.sha256 }))
      .sort((a2, b2) => String(a2.name).localeCompare(String(b2.name)));
    await store.setAgreementFields(agreementId, { attachments: meta, updatedAt: new Date() });
    return publicAttachment(doc);
  }

  async function remove(agreementId, attachmentId) {
    const store = await getStorage();
    const agreement = await store.getAgreement(agreementId);
    if (!agreement) throw fail("合同不存在", 404);
    if (effectiveStatus(agreement) !== "DRAFT") throw fail("已发出的合同不能修改附件", 409);
    const { applied } = await store.deleteAttachment(attachmentId, agreementId);
    if (!applied) throw fail("附件不存在", 404);
    const rows = await store.listAttachments(agreementId);
    const meta = rows
      .map((x) => ({ id: String(x._id), name: x.name, mime: x.mime, size: x.size, sha256: x.sha256 }))
      .sort((a2, b2) => String(a2.name).localeCompare(String(b2.name)));
    await store.setAgreementFields(agreementId, { attachments: meta, updatedAt: new Date() });
    return true;
  }

  async function list(agreementId) {
    const store = await getStorage();
    return (await store.listAttachments(agreementId)).map(publicAttachment);
  }

  /** Full document including base64 payload. Callers must have authorized access. */
  async function getBlob(agreementId, attachmentId) {
    const store = await getStorage();
    const doc = await store.getAttachment(attachmentId, agreementId);
    if (!doc) throw fail("附件不存在", 404);
    return doc;
  }

  async function listBlobs(agreementId) {
    const store = await getStorage();
    return store.listAttachments(agreementId);
  }

  /** Signer-facing download: the token is the authorization. */
  async function getForSigner(agreementId, attachmentId) {
    const store = await getStorage();
    const doc = await store.getAttachment(attachmentId, agreementId);
    if (!doc) throw fail("附件不存在", 404);
    return doc;
  }

  return { add, remove, list, getBlob, listBlobs, getForSigner };
}
