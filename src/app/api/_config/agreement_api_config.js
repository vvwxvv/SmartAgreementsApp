// Auto-generated API config for Prisma model Agreement
export const agreementApiConfig = {
  // Basic configuration
  collectionName: 'Agreement',

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
  defaultSortField: 'createdAt',
  defaultSortOrder: 1,

  // Schema configuration - matches Prisma Agreement model
  requiredFields: ["number", "createdById", "title", "body", "consentText"],
  uniqueFields: ["number"],
  searchableFields: ["title", "body", "number", "createdById", "consentText", "contentHash", "voidReason"],
  arrayFields: [],
  jsonFields: [],
  booleanFields: [],
  numberFields: ["revision"],
  heavyFields: [],
  validFields: ["id", "number", "createdById", "title", "body", "consentText", "status", "contentHash", "revision", "expiresAt", "sentAt", "completedAt", "voidedAt", "voidReason", "createdAt", "updatedAt", "language"],

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
