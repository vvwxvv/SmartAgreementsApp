// Auto-generated API config for Prisma model SigningEvent
export const signing_eventApiConfig = {
  // Basic configuration
  collectionName: 'SigningEvent',

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
  defaultSortField: 'updatedAt',
  defaultSortOrder: 1,

  // Schema configuration - matches Prisma SigningEvent model
  requiredFields: ["agreementId", "type"],
  uniqueFields: [],
  searchableFields: ["type", "agreementId", "signerId", "ipHash", "meta"],
  arrayFields: [],
  jsonFields: [],
  booleanFields: [],
  numberFields: [],
  heavyFields: [],
  validFields: ["id", "agreementId", "signerId", "type", "at", "ipHash", "meta", "language"],

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
