/** Manager API projections: never expose signatures, tokens or private notes. */

const pick = (obj, keys) => {
  const out = {};
  for (const key of keys) {
    if (obj && obj[key] !== undefined) out[key] = obj[key];
  }
  // Mongo/local documents carry _id; the API contract exposes id.
  if (out.id === undefined && obj && obj._id !== undefined) out.id = String(obj._id);
  return out;
};

export function publicSigner(s) {
  return pick(s, ['id', 'email', 'label', 'partyKey', 'order', 'signed', 'signedAt', 'signedIp', 'signatureHash', 'declined', 'declinedAt', 'declineReason']);
}

export function agreementSummary(a) {
  return pick(a, ['id', 'number', 'title', 'category', 'status', 'lang', 'createdAt', 'sentAt', 'completedAt', 'expiresAt', 'signDeadline', 'termEnd', 'termMonths', 'effectiveAt', 'renewedFrom', 'renewedBy', 'renewalStatus', 'renewalDeadline', 'hashV', 'effectiveMode', 'contentHash', 'declinedAt', 'declinedBy', 'declineReason', 'total', 'signed']);
}

export function agreementDetail(a) {
  return {
    ...agreementSummary(a),
    body: a && a.body != null ? a.body : null,
    consentText: a && a.consentText != null ? a.consentText : null,
    parties: a && a.parties ? a.parties : null,
    attachments: a && Array.isArray(a.attachments) ? a.attachments : [],
  };
}

export function publicEvent(e) {
  return pick(e, ['type', 'at', 'signerId']);
}

export function publicPartyInfo(p) {
  return pick(p, ['id', 'kind', 'name', 'nameEn', 'contactPerson', 'legalRepresentative', 'email', 'phone', 'wechat', 'address', 'addressEn', 'postalCode', 'isSelf', 'lang', 'archivedAt', 'createdAt', 'updatedAt']);
}
