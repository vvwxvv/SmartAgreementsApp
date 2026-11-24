// Single source of truth for the indexes Prisma schema cannot express.
// init-indexes.mjs applies it; tests assert the Prisma @unique fields are covered.
export const INDEX_SPEC = [
  { collection: 'Agreement', keys: { number: 1 }, options: { unique: true, name: 'number_unique' } },
  { collection: 'Agreement', keys: { status: 1, createdAt: -1 }, options: { name: 'status_created' } },
  { collection: 'Agreement', keys: { createdById: 1, createdAt: -1 }, options: { name: 'creator_created' } },
  { collection: 'AgreementSigner', keys: { agreementId: 1, email: 1 }, options: { unique: true, name: 'agreement_email_unique' } },
  { collection: 'AgreementSigner', keys: { agreementId: 1, order: 1 }, options: { name: 'agreement_order' } },
  {
    collection: 'AgreementSigner',
    keys: { accessTokenHash: 1 },
    options: {
      unique: true,
      name: 'accessTokenHash_partial',
      partialFilterExpression: { accessTokenHash: { $type: 'string' } },
    },
  },
  { collection: 'AgreementSigner', keys: { email: 1 }, options: { name: 'email_idx' } },
  { collection: 'SigningEvent', keys: { agreementId: 1, at: -1 }, options: { name: 'agreement_at' } },
];
