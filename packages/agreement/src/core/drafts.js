/**
 * Draft lifecycle: create, edit, list, extend the deadline, set the term.
 * Operator-facing; every write goes through the storage adapter's guards.
 */
import { compileTemplate, hasUnfilledVariables } from "./template.js";
import { normalizeSignDeadline, normalizeExtension } from "./terms.js";
import { DRAFT_LIMITS, cleanPartyInput, fingerprint, agreementYear, effectiveStatus, publicSigner } from "./domain.js";

export function createDrafts(ctx) {
  const { getStorage, appendEvent } = ctx;

async function nextNumber() {
  const store = await getStorage();
  return store.nextAgreementNumber(agreementYear());
}

async function resolveParty(store, ref, key) {
  const contactId = typeof ref === "string" ? ref : ref && ref.contactId;
  if (!contactId) throw new Error(key + " 联系人不能为空");
  const c = await store.getPartyInfo(contactId);
  if (!c) throw new Error(key + " 联系人不存在");
  return {
    partyInfoId: String(c._id),
    kind: c.kind || "person",
    name: c.name,
    nameEn: c.nameEn || null,
    contactPerson: c.contactPerson || null,
    legalRepresentative: c.legalRepresentative || null,
    email: c.email || null,
    phone: c.phone || null,
    address: c.address || null,
    addressEn: c.addressEn || null,
  };
}

async function createDraft(input = {}, actor = "operator") {
  let { title, category, body, consentText, titleEn, bodyEn, consentTextEn, lang, expiresAt, signDeadline, termMonths, termEnd, effectiveAt, renewalOf, signers = [], partyA, partyB } = input || {};
  let parties = null;
  let templateBody = null;

  if (partyA || partyB) {
    const store0 = await getStorage();
    parties = {
      partyA: await resolveParty(store0, partyA, "甲方"),
      partyB: await resolveParty(store0, partyB, "乙方"),
    };
    templateBody = String(body || "");
    body = compileTemplate(templateBody, parties).body;
    // Only derive signers from the two parties when the caller did not supply
    // an explicit list. Renewal passes every signer (including third parties).
    if (!signers.length) {
      signers = [
        parties.partyA.email ? { email: parties.partyA.email, label: "甲方 " + parties.partyA.name, partyKey: "partyA" } : null,
        parties.partyB.email ? { email: parties.partyB.email, label: "乙方 " + parties.partyB.name, partyKey: "partyB" } : null,
      ].filter(Boolean);
    }
  }

  const clean = (signers || [])
    .map((s) => ({
      email: String(s.email || "").trim().toLowerCase(),
      label: String(s.label || "").trim() || null,
      partyKey: s.partyKey || null,
    }))
    .filter((s) => s.email);

  if (!String(title || "").trim()) throw new Error("标题不能为空");
  if (!String(body || "").trim()) throw new Error("合同正文不能为空");
  if (!clean.length) throw new Error("至少需要一位签署人");
  if (new Set(clean.map((s) => s.email)).size !== clean.length) throw new Error("签署人邮箱不能重复");
  for (const s of clean) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) throw new Error(`邮箱格式不正确：${s.email}`);

  // Fail fast, before a number is allocated. send() used to be the first place
  // these were checked, so every rejected draft silently burned an AGR number.
  if (String(title).trim().length > DRAFT_LIMITS.title) {
    const e = new Error("标题过长（最多 " + DRAFT_LIMITS.title + " 字符）"); e.status = 400; throw e;
  }
  if (String(body || "").length > DRAFT_LIMITS.body) {
    const e = new Error("正文过长（最多 " + DRAFT_LIMITS.body + " 字符）"); e.status = 400; throw e;
  }
  if (String(consentText || "").length > DRAFT_LIMITS.consentText) {
    const e = new Error("同意文案过长（最多 " + DRAFT_LIMITS.consentText + " 字符）"); e.status = 400; throw e;
  }
  if (clean.length > DRAFT_LIMITS.signers) {
    const e = new Error("签署人过多（最多 " + DRAFT_LIMITS.signers + " 位）"); e.status = 400; throw e;
  }
  if (hasUnfilledVariables(body)) {
    const e = new Error("正文仍有未填写的模板变量"); e.status = 400; throw e;
  }
  if (parties) {
    for (const key of ["partyA", "partyB"]) {
      const p = parties[key] || {};
      if (!String(p.name || "").trim()) { const e = new Error(key + " 名称不能为空"); e.status = 400; throw e; }
      if (!String(p.email || "").trim()) { const e = new Error(key + " 联系人缺少邮箱，无法发出"); e.status = 400; throw e; }
    }
  }

  const store = await getStorage();
  const now = new Date();
  const _id = store.newId();
  const deadline = normalizeSignDeadline(signDeadline || expiresAt, now);
  if (deadline && deadline.error) {
    const e = new Error(deadline.error); e.status = 400; throw e;
  }
  const months = Number(termMonths);
  const termMonthsClean = Number.isFinite(months) && months > 0 ? months : null;

  await store.insertAgreement({
    _id,
    number: await nextNumber(),
    createdById: actor,
    title: String(title).trim(),
    category: category ? String(category).trim() : null,
    body: String(body),
    parties: parties || null,
    templateBody: templateBody || null,
    consentText: String(consentText || "我已阅读并同意本合同，自愿以电子方式签署。"),
    titleEn: titleEn ? String(titleEn).trim() : null,
    bodyEn: bodyEn ? String(bodyEn) : null,
    consentTextEn: consentTextEn ? String(consentTextEn) : null,
    lang: lang === "en" ? "en" : "zh",
    status: "DRAFT",
    contentHash: null,
    revision: 0,
    signDeadline: deadline,
    expiresAt: deadline,
    hashV: 4,
    attachments: [],
    effectiveMode: effectiveAt ? "fixed" : "completion",
    termMonths: termMonthsClean,
    termEnd: termEnd ? new Date(termEnd) : null,
    termEndExplicit: Boolean(termEnd),
    effectiveAt: effectiveAt ? new Date(effectiveAt) : null,
    renewedFrom: null,
    renewedBy: null,
    renewalOf: renewalOf ? String(renewalOf) : null,
    renewalStatus: null,
    sentAt: null,
    completedAt: null,
    voidedAt: null,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  });

  await store.insertSigners(
    clean.map((s, i) => ({
      _id: store.newId(),
      agreementId: _id,
      email: s.email,
      label: s.label,
      labelEn: s.labelEn || null,
      partyKey: s.partyKey || null,
      order: i,
      signedName: null,
      signedAt: null,
      emailVerifiedAt: null,
      signatureImage: null,
      ipHash: null,
      uaHash: null,
      contentHash: null,
      accessTokenHash: null,
      codeHash: null,
      codeExpiresAt: null,
      codeAttempts: 0,
      codeSentAt: null,
      createdAt: now,
      updatedAt: now,
    }))
  );

  await appendEvent({ agreementId: _id, type: "draft.created", meta: actor });
  return String(_id);
}

async function updateDraft(id, patch) {
  const store = await getStorage();
  const allowed = {};
  for (const k of ["title", "body", "consentText"]) {
    if (typeof patch?.[k] === "string") allowed[k] = patch[k];
  }
  if (patch?.expiresAt !== undefined) allowed.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
  allowed.updatedAt = new Date();

  const { applied } = await store.updateDraft(id, allowed);
  if (!applied) throw new Error("只能编辑草稿");
  return true;
}

async function patchDraft(id, patch = {}) {
  const store = await getStorage();
  const allowed = {};
  for (const key of ["title", "body", "consentText"]) {
    if (typeof patch[key] === "string") allowed[key] = patch[key];
  }
  if (patch.expiresAt !== undefined) allowed.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
  if (!Object.keys(allowed).length) throw new Error("没有可更新的字段");
  const { applied } = await store.updateDraft(id, allowed);
  if (!applied) {
    const err = new Error("只能编辑草稿");
    err.status = 409;
    throw err;
  }
  return true;
}

async function listAgreements({ limit = 50, cursor } = {}) {
  const store = await getStorage();
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = await store.listAgreements(n, cursor);
  const ids = rows.map((r) => r._id);
  const all = await store.listSignersForAgreements(ids);
  const byAgreement = new Map();
  for (const s of all) {
    const k = String(s.agreementId);
    if (!byAgreement.has(k)) byAgreement.set(k, []);
    byAgreement.get(k).push({
      id: String(s._id),
      label: s.label,
      email: s.email,
      order: s.order ?? 0,
      signed: Boolean(s.signedAt),
      signedAt: s.signedAt,
      signedIp: s.signedIp || null,
      signatureHash: s.signatureHash || null,
      tsaTime: s.tsaTime || null,
    });
  }
  return rows.map((r) => {
    const list = (byAgreement.get(String(r._id)) || []).sort((a, b) => a.order - b.order);
    return {
      id: String(r._id),
      number: r.number,
      title: r.title,
      category: r.category || null,
      body: r.body,
      consentText: r.consentText,
      titleEn: r.titleEn || null,
      bodyEn: r.bodyEn || null,
      consentTextEn: r.consentTextEn || null,
      lang: r.lang || "zh",
      status: effectiveStatus(r),
      contentHash: r.contentHash || null,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
      completedAt: r.completedAt,
      expiresAt: r.expiresAt,
      total: list.length,
      signed: list.filter((s) => s.signed).length,
      signers: list,
    };
  });
}

async function extendAgreement(id, expiresAt, actor = "operator") {
  const next = new Date(expiresAt);
  if (!Number.isFinite(next.getTime())) {
    const e = new Error("到期时间无效"); e.status = 400; throw e;
  }
  if (next.getTime() <= Date.now()) {
    const e = new Error("到期时间必须晚于现在"); e.status = 400; throw e;
  }
  const store = await getStorage();
  const a = await store.getAgreement(id);
  if (!a) { const e = new Error("合同不存在"); e.status = 404; throw e; }
  if (a.status === "VOIDED") { const e = new Error("已作废合同不能延期"); e.status = 409; throw e; }
  if (a.status === "COMPLETED") { const e = new Error("已完成合同请用续签新建"); e.status = 409; throw e; }
  if (effectiveStatus(a) === "EXPIRED") {
    const e = new Error("合同已过期，请作废重发或续签");
    e.status = 409;
    throw e;
  }
  // Without sentAt we cannot bound the total lifetime; refuse rather than
  // letting a legacy SENT link be extended forever.
  if (a.status === "SENT" && !a.sentAt) {
    const e = new Error("缺少首次发送时间，无法延期；请作废重发");
    e.status = 409;
    throw e;
  }
  // Legacy (v1) documents hashed expiresAt; extending a sent one would break
  // signatures already collected. Reissue instead.
  if ((a.hashV ?? 1) === 1 && a.status === "SENT") {
    const e = new Error("旧版合同的链接不能延期；请作废重发");
    e.status = 409;
    throw e;
  }
  const dl = normalizeExtension(expiresAt, { sentAt: a.sentAt });
  if (dl && dl.error) { const e = new Error(dl.error); e.status = 400; throw e; }
  const { applied } = await store.transition(id, ["DRAFT", "SENT"], { signDeadline: dl, expiresAt: dl });
  if (!applied) { const e = new Error("合同当前状态不能延期"); e.status = 409; throw e; }
  if (a.renewedFrom) {
    // Keep the original's renewal snapshot in step: otherwise it would show
    // "renewal expired" after the renewal itself was extended.
    await store.setAgreementFields(String(a.renewedFrom), { renewalDeadline: dl });
  }
  await appendEvent({
    agreementId: id,
    type: "expiry.extended",
    meta: JSON.stringify({ from: a.signDeadline || a.expiresAt || null, to: dl.toISOString(), actor }),
  });
  return { ok: true, expiresAt: next.toISOString() };
}

async function setTermAgreement(id, { termMonths, termEnd, effectiveAt } = {}, actor = "operator") {
  const store = await getStorage();
  const a = await store.getAgreement(id);
  if (!a) { const e = new Error("合同不存在"); e.status = 404; throw e; }
  if (a.status !== "DRAFT" && a.status !== "SENT") {
    const e = new Error("当前状态不能修改期限"); e.status = 409; throw e;
  }
  const rows = await store.listSigners(id);
  if (rows.some((s) => s.signedAt)) {
    const e = new Error("已有人签署，期限不可修改；请作废重签或续签"); e.status = 409; throw e;
  }
  const months = Number(termMonths);
  const patch = {
    termMonths: Number.isFinite(months) && months > 0 ? months : null,
    termEnd: termEnd ? new Date(termEnd) : null,
    effectiveAt: effectiveAt ? new Date(effectiveAt) : null,
  };
  const { applied } = await store.transition(id, ["DRAFT", "SENT"], patch);
  if (!applied) { const e = new Error("期限未更新"); e.status = 409; throw e; }
  const after = await store.getAgreement(id);
  if (after.status === "SENT") {
    // The term is part of what gets signed; refresh the frozen hash.
    await store.setAgreementFields(id, { contentHash: fingerprint(after, rows) });
  }
  await appendEvent({ agreementId: id, type: "term.changed", meta: JSON.stringify({ from: { termMonths: a.termMonths, termEnd: a.termEnd, effectiveAt: a.effectiveAt }, to: patch, actor }) });
  return { ok: true, ...patch };
}

async function getAgreementDetail(id) {
  const store = await getStorage();
  const a = await store.getAgreement(id);
  if (!a) return null;
  const rows = await store.listSigners(id);
  const events = await store.listEvents(id, 50);
  return {
    agreement: { ...a, id: String(a._id), status: effectiveStatus(a) },
    signers: rows.map(publicSigner),
    events: events.map((e) => ({ type: e.type, at: e.at, signerId: e.signerId ? String(e.signerId) : null })),
  };
}

  return { createDraft, updateDraft, patchDraft, listAgreements, extendAgreement, setTermAgreement, getAgreementDetail, nextNumber };
}
