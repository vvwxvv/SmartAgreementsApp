// Auto-generated API config for Prisma model LoginCode
export const login_codeApiConfig = {
  // Basic configuration
  collectionName: 'LoginCode',

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

  // Schema configuration - matches Prisma LoginCode model
  requiredFields: ["email", "codeHash", "expiresAt"],
  uniqueFields: [],
  searchableFields: ["email", "codeHash"],
  arrayFields: [],
  jsonFields: [],
  booleanFields: [],
  numberFields: ["attempts"],
  heavyFields: [],
  validFields: ["id", "email", "codeHash", "expiresAt", "attempts", "createdAt", "language"],

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
