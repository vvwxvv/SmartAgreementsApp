/**
 * Renewal: claim the original, create a linked draft, keep reminders in step.
 */


export function createRenewal(ctx, { createDraft }) {
  const { getStorage, appendEvent } = ctx;

async function renewAgreement(id, actor = "operator") {
  const store = await getStorage();
  const a = await store.getAgreement(id);
  if (!a) { const e = new Error("合同不存在"); e.status = 404; throw e; }
  if (a.status === "VOIDED") { const e = new Error("已作废合同不能续签"); e.status = 409; throw e; }

  const staleBefore = Date.now() - 15 * 60 * 1000;

  // Recover an orphan: a claim exists but the draft was created before the
  // link could be written (crash window). Adopt that draft instead of leaking
  // another number.
  if (a.renewalStatus === "renewing" && !a.renewedBy) {
    const orphans = await store.findRenewalDrafts(id);
    if (orphans.length > 1) {
      const e = new Error("存在多份续签草稿，请人工处理后再试");
      e.status = 409;
      throw e;
    }
    if (orphans.length === 1) {
      const draft = orphans[0];
      await store.finishRenewal(id, String(draft._id), draft.signDeadline || null);
      return { id: String(draft._id), renewedFrom: String(id), adopted: true };
    }
  }

  // A linked renewal that still exists and is neither void nor past its own
  // signing deadline blocks a second one. Stale links are cleared first.
  if (a.renewedBy) {
    const linked = await store.getAgreement(String(a.renewedBy));
    const deadline = a.renewalDeadline ? new Date(a.renewalDeadline).getTime() : null;
    const alive = Boolean(linked) && linked.status !== "VOIDED" && (!deadline || deadline > Date.now());
    if (a.renewalStatus === "renewing" && alive) {
      const e = new Error("已有一份进行中的续签，请先完成或作废它");
      e.status = 409;
      throw e;
    }
    await store.setAgreementFields(id, { renewedBy: null, renewalStatus: null, renewalDeadline: null, renewalClaimAt: null });
  }

  const claim = await store.claimRenewalStart(id, staleBefore);
  if (!claim.applied) {
    const e = new Error("已有一份进行中的续签，请先完成或作废它");
    e.status = 409;
    throw e;
  }

  let newId = null;
  try {
    const rows = await store.listSigners(id);
    newId = await createDraft({
      title: String(a.title || "") + "（续签）",
      body: a.templateBody || a.body,
      consentText: a.consentText,
      termMonths: a.termMonths || null,
      effectiveAt: a.termEnd ? new Date(new Date(a.termEnd).getTime() + 86400000) : null,
      renewalOf: String(id),
      signers: rows.map((s) => ({ email: s.email, label: s.label, partyKey: s.partyKey })),
      partyA: a.parties && a.parties.partyA ? a.parties.partyA.partyInfoId : null,
      partyB: a.parties && a.parties.partyB ? a.parties.partyB.partyInfoId : null,
    }, actor);
    const created = await store.getAgreement(newId);
    const linked = await store.finishRenewal(id, String(newId), created.signDeadline || null);
    if (!linked.applied) {
      await store.transition(newId, ["DRAFT"], { status: "VOIDED", voidedAt: new Date(), voidReason: "renewal race" });
      const e = new Error("已有一份进行中的续签，请先完成或作废它");
      e.status = 409;
      throw e;
    }
    await store.setAgreementFields(newId, { renewedFrom: String(id) });
    await appendEvent({ agreementId: id, type: "renewed", meta: String(newId) });
    return { id: newId, renewedFrom: String(id) };
  } catch (e) {
    if (!newId) await store.releaseRenewal(id, claim.claimAt).catch(() => {});
    throw e;
  }
}

  return { renewAgreement };
}
