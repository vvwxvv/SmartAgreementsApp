// Auto-generated API config for Prisma model AgreementSigner
export const agreement_signerApiConfig = {
  // Basic configuration
  collectionName: 'AgreementSigner',

  // Pagination settings
  enablePagination: false,
  defaultPageSize: 10000,
  maxPageSize: 10000,

  // Feature flags
  enableSearch: true,
  enableSorting: true,
  enableSoftDelete: false,
  enableBulkOperations: false,
  enableAutoFillArtist: false,

  // Sorting
  defaultSortField: 'order',
  defaultSortOrder: 1,

  // Schema configuration - matches Prisma AgreementSigner model
  requiredFields: ["agreementId", "email"],
  uniqueFields: ["accessTokenHash"],
  searchableFields: ["email", "agreementId", "label", "signedName", "signatureImage", "ipHash", "uaHash", "contentHash", "accessTokenHash", "codeHash"],
  arrayFields: [],
  jsonFields: [],
  booleanFields: [],
  numberFields: ["order", "codeAttempts"],
  heavyFields: [],
  validFields: ["id", "agreementId", "email", "label", "order", "signedName", "signedAt", "emailVerifiedAt", "signatureImage", "ipHash", "uaHash", "contentHash", "accessTokenHash", "codeHash", "codeExpiresAt", "codeAttempts", "codeSentAt", "createdAt", "updatedAt", "language"],

  // Custom validation
  customValidation: async (data, operation) => {
    return { valid: true };
  },

  // Before hooks
  beforeCreate: async (data) => {
    return data;
  },

  beforeUpdate: async (id, data, existing) => {
    return data;
  },

  // Response transform
  transformResponse: async (data) => {
    return data;
  },
};
