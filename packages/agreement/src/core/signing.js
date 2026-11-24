/**
 * Signer-facing flow: issue links, view, sign, decline, void.
 * Concurrency is handled here (per-agreement lock + storage CAS).
 */
import { hmac, randomToken, safeEqual, sha256 } from "./hash.js";
import { validateSignatureImage } from "./signatureImage.js";
import { computeTermEnd } from "./terms.js";
import { hasUnfilledVariables } from "./template.js";
import { fingerprint, effectiveStatus, buildEvidence, evidenceHash, completionSeal } from "./domain.js";

export function createSigning(ctx) {
  const { getStorage, siteUrl, signSecret, withAgreementLock, sealToken, openTokenDetailed, signerAad, tsa, attachments, evidenceSigner, appendEvent } = ctx;

async function sendAgreement(id, req) {
  const store = await getStorage();
  const a = await store.getAgreement(id);
  if (!a) throw new Error("合同不存在");
  if (a.status !== "DRAFT") throw new Error("只有草稿可以发出");

  if (a.parties) {
    for (const key of ["partyA", "partyB"]) {
      const p = a.parties[key] || {};
      if (!String(p.name || "").trim()) throw new Error(key + " 名称不能为空");
      if (!String(p.email || "").trim()) throw new Error(key + " 联系人缺少邮箱，无法发出");
    }
    if (hasUnfilledVariables(a.body)) throw new Error("正文仍有未填写的模板变量");
  }

  const rows = await store.listSigners(id);
  if (!rows.length) throw new Error("至少需要一位签署人");

  const hash = fingerprint(a, rows);
  const links = [];
  const now = new Date();

  for (const s of rows) {
    const token = randomToken(32);
    // Keep the raw token (encrypted) so the operator can copy the same invite
    // again later without invalidating a link already sent in a chat.
    await store.updateSigner(String(s._id), {
      accessTokenHash: sha256(token),
      accessTokenEnc: sealToken(token, signerAad(id, s._id)),
      updatedAt: now,
    });
    // The operator copies this link and sends it by hand. Holding the link is
    // the authorization to sign — no code, no gesture, no e-mail.
    links.push({ email: s.email, label: s.label, url: `${siteUrl(req)}/sign/${token}` });
  }

  const { applied } = await store.transition(
    id,
    ["DRAFT"],
    { status: "SENT", contentHash: hash, sentAt: now },
    { revision: 1 }
  );
  if (!applied) throw new Error("合同已发出");

  await appendEvent({ agreementId: id, type: "sent", meta: `${rows.length} signer(s)` });

  return { links, contentHash: hash };
}

/** Re-derive invite links for an agreement that is already sent.
 *  Does not rotate anything: a link already in someone's chat keeps working. */
async function getLinks(agreementId, req) {
  const store = await getStorage();
  const a = await store.getAgreement(agreementId);
  if (!a) throw new Error("合同不存在");
  if (a.status !== "SENT") return { links: [], legacy: 0, failed: [] };
  const rows = await store.listSigners(agreementId);
  const out = [];
  const failed = [];
  let legacy = 0;
  for (const s of rows) {
    if (s.signedAt) continue;
    const aad = signerAad(agreementId, s._id);
    const opened = s.accessTokenEnc ? openTokenDetailed(s.accessTokenEnc, aad) : null;
    let token = opened?.token ?? null;

    if (token && opened.version === 1) {
      // Migration window: re-seal the same token as v2 (AAD-bound) so the old
      // binding-less blob does not stay readable forever. The token value is
      // unchanged, so links already sent keep working.
      await store.updateSigner(String(s._id), { accessTokenEnc: sealToken(token, aad) });
    }

    if (!token && s.accessToken) {
      // Short-lived plaintext field: encrypt it in place and drop the original.
      token = s.accessToken;
      // One-off migration of the short-lived plaintext column.
      await store.updateSigner(String(s._id), { accessTokenEnc: sealToken(token, aad) });
      await store.unsetSignerField(String(s._id), "accessToken");
    }

    if (!token) {
      if (s.accessTokenEnc) {
        // Ciphertext exists but will not open: wrong/removed key, corrupted
        // data, or a blob moved to another agreement/signer (v2 AAD). This is
        // a configuration/data fault, NOT "old data that cannot be recovered".
        failed.push({ signerId: String(s._id), email: s.email, label: s.label });
      } else if (s.accessTokenHash) {
        // Nothing recoverable was ever stored for this row.
        legacy += 1;
      }
      continue;
    }
    out.push({
      signerId: String(s._id),
      email: s.email,
      label: s.label,
      url: `${siteUrl(req)}/sign/${token}`,
    });
  }
  if (out.length) {
    await appendEvent({ agreementId, type: "linksViewed", meta: String(out.length) });
  }
  return { links: out, legacy, failed };
}

async function rotateLink(agreementId, signerId, req) {
  const store = await getStorage();
  const a = await store.getAgreement(agreementId);
  if (!a || a.status !== "SENT") throw new Error("合同不在可发送状态");
  const s = await store.getSigner(signerId, agreementId);
  if (!s) throw new Error("签署人不存在");
  // Rotating a used link would invalidate the address printed on a signed
  // copy for no benefit; the signature itself is already the record.
  if (s.signedAt) {
    const e = new Error("该签署人已签署，链接无需更换");
    e.status = 409;
    throw e;
  }
  const token = randomToken(32);
  await store.updateSigner(String(s._id), {
    accessTokenHash: sha256(token),
    accessTokenEnc: sealToken(token, signerAad(agreementId, s._id)),
    updatedAt: new Date(),
  });
  return { email: s.email, label: s.label, url: `${siteUrl(req)}/sign/${token}` };
}

async function voidAgreement(id, reason) {
  return withAgreementLock(id, async () => {
    const store = await getStorage();
    const { applied } = await store.transition(
      id,
      ["DRAFT", "SENT", "DECLINED"],
      { status: "VOIDED", voidedAt: new Date(), voidReason: String(reason || "") },
      { revision: 1 }
    );
    if (!applied) throw new Error("只有未完成的合同可以作废");
    const a = await store.getAgreement(id);
    if (a && a.renewedFrom) {
      // The renewal never took effect: unlink it so the original keeps its
      // renewal reminder instead of showing "renewed".
      await store.setAgreementFields(String(a.renewedFrom), { renewalStatus: null, renewedBy: null });
    }
    await appendEvent({ agreementId: id, type: "voided", meta: reason });
    return true;
  });
}

async function signerByToken(token) {
  if (!token || typeof token !== "string") return null;
  const store = await getStorage();
  const s = await store.findSignerByTokenHash(sha256(token));
  if (!s) return null;
  const a = await store.getAgreement(String(s.agreementId));
  if (!a) return null;
  return { signer: s, agreement: a };
}

async function getSignerView(token, viewerCookie) {
  const hit = await signerByToken(token);
  if (!hit) return null;
  const { signer, agreement } = hit;

  // Voided means the document is dead: the link must not keep showing the body
  // or the signatures. Completed links stay readable on purpose — that is how
  // the signer retrieves their own signed copy.
  if (effectiveStatus(agreement) === "VOIDED") return null;

  // No gesture: holding the link is the authorization to read and sign.
  // (The operator hands the link to exactly one signer.)
  const unlocked = true;

  const store = await getStorage();
  const rows = await store.listSigners(String(agreement._id));

  return {
    agreement: {
      id: String(agreement._id),
      number: agreement.number,
      title: agreement.title,
      body: unlocked ? agreement.body : null,
      consentText: agreement.consentText,
      status: effectiveStatus(agreement),
      sentAt: agreement.sentAt,
      expiresAt: agreement.expiresAt,
      completedAt: agreement.completedAt,
      declinedAt: agreement.declinedAt || null,
      declineReason: agreement.declineReason || null,
      contentHash: agreement.contentHash,
    },
    me: {
      id: String(signer._id),
      email: signer.email,
      label: signer.label,
      signed: Boolean(signer.signedAt),
      signedName: signer.signedName,
      signedAt: signer.signedAt,
      signatureImage: signer.signatureImage ? `data:image/png;base64,${signer.signatureImage}` : null,
      signedIp: signer.signedIp || null,
      signatureHash: signer.signatureHash || null,
      tsaTime: signer.tsaTime || null,
      declined: Boolean(signer.declinedAt),
      declinedAt: signer.declinedAt || null,
      verified: unlocked,
    },
    // Every signer's block is part of the contract itself: as soon as one
    // person signs, the others see the image + record on their own copy.
    // IP is evidence stored for the record and printed on the PDF; it is not
    // something the other party needs to see while filling out the same page.
    signers: rows.map((s) => ({
      id: String(s._id),
      label: s.label,
      isMe: String(s._id) === String(signer._id),
      signed: Boolean(s.signedAt),
      signedAt: s.signedAt,
      signedIp: String(s._id) === String(signer._id) ? s.signedIp || null : null,
      signatureHash: s.signatureHash || null,
      declined: Boolean(s.declinedAt),
      tsaUrl: s.tsaUrl || null,
      tsaTime: s.tsaTime || null,
      image: s.signatureImage ? `data:image/png;base64,${s.signatureImage}` : null,
    })),
    attachments: await attachments.list(String(agreement._id)),
    unlocked,
    canSign: effectiveStatus(agreement) === "SENT" && !signer.signedAt,
  };
}

function signerCookie(signerId) {
  return `${signerId}.${hmac(`sign:${signerId}`, signSecret())}`;
}

function verifySignerCookie(value) {
  if (!value || typeof value !== "string") return null;
  const [id, sig] = value.split(".");
  if (!id || !sig) return null;
  return safeEqual(sig, hmac(`sign:${id}`, signSecret())) ? id : null;
}

/**
 * A signer may decline. One refusal stops the contract: the remaining links stay
 * readable (so everyone can see why) but can no longer sign, and the operator
 * must void/reissue or renew.
 */
async function declineAgreement(token, { reason } = {}, { ip } = {}) {
  const hit = await signerByToken(token);
  if (!hit) { const e = new Error("链接无效或已失效"); e.status = 404; throw e; }
  const { signer, agreement } = hit;

  return withAgreementLock(String(agreement._id), async () => {
    const store = await getStorage();
    const fresh = await store.getAgreement(String(agreement._id));
    if (!fresh) { const e = new Error("合同不存在"); e.status = 404; throw e; }
    const status = effectiveStatus(fresh);
    if (status === "DECLINED") return { alreadyDeclined: true };
    if (status !== "SENT") {
      const e = new Error(status === "VOIDED" ? "合同已作废" : "合同当前不可拒绝");
      e.status = 409;
      throw e;
    }
    if (signer.signedAt) {
      const e = new Error("你已签署，不能再拒绝；如需撤销请联系发起人");
      e.status = 409;
      throw e;
    }

    const text = String(reason || "").trim().slice(0, 500);
    const now = new Date();
    await store.updateSigner(String(signer._id), {
      declinedAt: now,
      declineReason: text || null,
      updatedAt: now,
    });

    const { applied } = await store.transition(
      String(agreement._id),
      ["SENT"],
      {
        status: "DECLINED",
        declinedAt: now,
        declinedBy: String(signer._id),
        declineReason: text || null,
      },
      { revision: 1 }
    );
    if (!applied) {
      const after = await store.getAgreement(String(agreement._id));
      if (after && effectiveStatus(after) === "DECLINED") return { alreadyDeclined: true };
      const e = new Error("合同当前不可拒绝");
      e.status = 409;
      throw e;
    }

    await appendEvent({
      agreementId: String(agreement._id),
      signerId: String(signer._id),
      type: "declined",
      ipHash: ip ? sha256(String(ip)) : null,
      meta: text || null,
    });
    return { declined: true };
  });
}

async function signAgreement(token, { image, contentHash } = {}, { ip, ua } = {}) {
  const hit = await signerByToken(token);
  if (!hit) throw new Error("链接无效或已失效");
  const { signer, agreement } = hit;

  return withAgreementLock(String(agreement._id), async () => {
  if (agreement.contentHash && contentHash && String(contentHash) !== String(agreement.contentHash)) {
    const e = new Error("内容已更新，请刷新页面重新阅读后再签");
    e.status = 409;
    throw e;
  }

  if (effectiveStatus(agreement) !== "SENT") {
    if (signer.signedAt) return { alreadySigned: true };
    const st = effectiveStatus(agreement);
    const msg = st === "VOIDED" ? "合同已作废，签署未生效"
      : st === "DECLINED" ? "合同已被拒绝，签署未生效"
      : "合同当前不可签署";
    const err = new Error(msg);
    err.status = 409;
    throw err;
  }

  const checked = validateSignatureImage(image);
  if (!checked.ok) {
    const WHY = {
      "too-large": "签名图片过大",
      blank: "签名看起来是空的，请重新签名",
      dimensions: "签名太小或比例异常，请在签名框内写大一点",
    };
    throw new Error(WHY[checked.reason] || "签名图片格式不正确");
  }
  const bytes = checked.bytes;

  const store = await getStorage();
  const rows = await store.listSigners(String(agreement._id));
  const hash = fingerprint(agreement, rows);
  if (hash !== agreement.contentHash) {
    const err = new Error("合同内容已变更，请联系发起人重新发出");
    err.status = 409;
    throw err;
  }

  const now = new Date();
  const cleanIp = String(ip || "").split(",")[0].trim();
  const uaHash = ua ? sha256(String(ua)) : null;

  // A hash cannot be "decoded" — by design. What makes it meaningful is that
  // it is a digest over a named, dated, human-readable evidence record, so
  // anyone can rebuild that record and recompute the digest.
  const evidence = buildEvidence({
    agreement,
    signer,
    contentHash: hash,
    signedAt: now,
    ip: cleanIp,
    uaHash,
    imageSha256: sha256(checked.bytes.toString("base64")),
  });
  const signatureHash = evidenceHash(evidence);

  // Server-side signature: proves the digest was produced by this deployment's
  // key, so a database writer cannot recompute it after editing evidence.
  const sealed = evidenceSigner.sign(signatureHash);

  // Third-party proof of "this digest existed at this time". Best effort: a
  // failed TSA must not block a signature, but the certificate says so.
  const stamp = await tsa(signatureHash).catch(() => ({ ok: false }));

  // Atomic compare-and-set: exactly one concurrent request can flip
  // signedAt from null. The loser gets applied=false and never overwrites.
  const { applied } = await store.commitSignature({
    signerId: String(signer._id),
    agreementId: String(agreement._id),
    email: signer.email,
    patch: {
      signedAt: now,
      signatureImage: checked.bytes.toString("base64"),
      contentHash: hash,
      signatureHash,
      signedIp: cleanIp || null,
      ipHash: cleanIp ? sha256(cleanIp) : null,
      uaHash,
      tsaUrl: stamp.ok ? stamp.url : null,
      tsaTime: stamp.ok ? stamp.time : null,
      tsaToken: stamp.ok ? stamp.token : null,
      signatureSig: sealed ? sealed.sig : null,
      signatureKeyId: sealed ? sealed.kid : null,
      signatureSigAlg: sealed ? sealed.alg : null,
      updatedAt: now,
    },
  });
  if (!applied) return { alreadySigned: true };

  // The agreement is authoritative: a void may have landed between the status
  // check and this write. Record the attempt and return 409; never "success".
  const after = await store.getAgreement(String(agreement._id));
  if (!after || (after.status !== "SENT" && after.status !== "COMPLETED")) {
    await appendEvent({
      agreementId: String(agreement._id),
      signerId: String(signer._id),
      type: "signedAfterVoid",
      ipHash: ip ? sha256(String(ip)) : null,
      meta: after ? after.status : "missing",
    });
    const err = new Error("合同已作废，签署未生效");
    err.status = 409;
    throw err;
  }

  await appendEvent({
    agreementId: String(agreement._id),
    signerId: String(signer._id),
    type: "signed",
    ipHash: ip ? sha256(String(ip)) : null,
    meta: signatureHash,
  });

  const remaining = await store.countUnsigned(String(agreement._id));
  if (remaining === 0) {
    const doneTermEnd = computeTermEnd({
      termMonths: agreement.termMonths,
      termEnd: agreement.termEnd,
      effectiveAt: agreement.effectiveAt,
      completedAt: now,
    });
    const done = await store.transition(
      String(agreement._id),
      ["SENT"],
      {
        status: "COMPLETED",
        completedAt: now,
        termEnd: doneTermEnd,
      },
      { revision: 1 }
    );
    if (done.applied) {
      // Seal the completion moment itself: completedAt and the final term end
      // are not inside the per-signer evidence, so they need their own hash.
      const sealedRows = await store.listSigners(String(agreement._id));
      const completionHash = completionSeal({
        agreementId: String(agreement._id),
        number: agreement.number,
        contentHash: agreement.contentHash,
        completedAt: now,
        termEnd: doneTermEnd,
        signers: sealedRows,
      });
      const completionSealed = evidenceSigner.sign(completionHash);
      await store.setAgreementFields(String(agreement._id), {
        completionHashV: 1,
        completionHash,
        completionSig: completionSealed ? completionSealed.sig : null,
        completionKeyId: completionSealed ? completionSealed.kid : null,
        completionSigAlg: completionSealed ? completionSealed.alg : null,
      });
      if (agreement.renewedFrom) {
        await store.setAgreementFields(String(agreement.renewedFrom), { renewalStatus: "renewed" });
      }
      await appendEvent({ agreementId: String(agreement._id), type: "completed", meta: JSON.stringify({ termEnd: doneTermEnd, hashV: agreement.hashV ?? 1 }) });
    } else {
      // A void may have won between the post-commit check and this transition.
      const st = await store.getAgreement(String(agreement._id));
      if (!st || st.status === "VOIDED") {
        await appendEvent({
          agreementId: String(agreement._id),
          signerId: String(signer._id),
          type: "signedAfterVoid",
          ipHash: ip ? sha256(String(ip)) : null,
          meta: st ? st.status : "missing",
        });
        const err = new Error("合同已作废，签署未生效");
        err.status = 409;
        throw err;
      }
    }
  }

  return {
    completed: remaining === 0,
    alreadySigned: false,
    record: { signedAt: now, ip: cleanIp || null, signatureHash, contentHash: hash },
  };
  });
}

  return { sendAgreement, getLinks, rotateLink, voidAgreement, signerByToken, getSignerView, signerCookie, verifySignerCookie, signAgreement, declineAgreement };
}
