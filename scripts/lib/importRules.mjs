// Pure rules used by import-local-to-mongo.mjs so they can be tested without
// a generated Prisma client.

export function isP2002(error) {
  return Boolean(error && error.code === 'P2002');
}

function targetText(error) {
  const t = error && error.meta ? error.meta.target : null;
  if (Array.isArray(t)) return t.join('_');
  return t == null ? '' : String(t);
}

/** Prisma reports either field names or the constraint/index name, depending on
 *  the connector. Normalise both so a conflict can be attributed. */
export function p2002IndexName(error) {
  const t = targetText(error);
  if (t.includes('accessTokenHash')) return 'accessTokenHash_partial';
  if (t.includes('number')) return 'number_unique';
  if (t.includes('agreementId') || t.includes('email')) return 'agreement_email_unique';
  return t;
}

export function refuseFresh(existingCount, allowMerge) {
  return Number(existingCount) > 0 && !allowMerge;
}

export function shouldSkipDependent(name, data, skippedParentIds) {
  if (name !== 'AgreementSigner' && name !== 'SigningEvent') return false;
  const parent = data && data.agreementId;
  return parent !== undefined && skippedParentIds.has(String(parent));
}

/** The exact command the import uses; $max never lowers a live counter. */
export function counterMaxCommand(data) {
  return {
    update: 'Counter',
    updates: [{ q: { _id: data.id }, u: { $max: { seq: data.seq } }, upsert: true }],
  };
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toJSON === 'function') return canonical(value.toJSON());
  if (Array.isArray(value)) return value.map(canonical);
  const out = {};
  for (const k of Object.keys(value).sort()) {
    if (value[k] !== undefined) out[k] = canonical(value[k]);
  }
  return out;
}

/** True only when the stored row already holds exactly what we would import.
 *  A shared _id with different content is a conflict, not an idempotent re-run. */
export function sameContent(existing, incoming) {
  if (!existing) return false;
  const picked = {};
  for (const k of Object.keys(incoming)) {
    if (k !== '__csvError') picked[k] = existing[k];
  }
  return JSON.stringify(canonical(picked)) === JSON.stringify(canonical(incoming));
}

export function decideAgreementConflict(error, sameId, same) {
  const index = p2002IndexName(error);
  if (index && index !== 'number_unique') {
    return { action: 'fail', reason: 'conflict on ' + index };
  }
  if (sameId && same) return { action: 'skip-idempotent', reason: 'identical document already exists' };
  if (sameId && !same) return { action: 'fail', reason: 'same _id but different content' };
  return { action: 'fail', reason: 'number already exists with a different id' };
}

export function decideSignerConflict(error) {
  const index = p2002IndexName(error);
  if (index === 'accessTokenHash_partial') {
    return { action: 'fail', reason: 'accessTokenHash is already used by another signer' };
  }
  return { action: 'skip', reason: index || 'duplicate signer' };
}
