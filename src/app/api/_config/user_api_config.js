// Auto-generated API config for Prisma model User
export const userApiConfig = {
  // Basic configuration
  collectionName: 'User',

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

  // Schema configuration - matches Prisma User model
  requiredFields: ["email"],
  uniqueFields: ["email"],
  searchableFields: ["name", "email"],
  arrayFields: [],
  jsonFields: [],
  booleanFields: [],
  numberFields: [],
  heavyFields: [],
  validFields: ["id", "email", "name", "createdAt", "language"],

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
