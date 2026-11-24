const NOT_READY = "agreement core is not wired in this P1 preview build";

/**
 * Validate host configuration early. Throwing at import time beats a 500 later.
 * Rules are intentionally strict: missing auth must deny, never default-allow.
 */
export function defineAgreement(config) {
  const errors = [];
  if (!config || typeof config !== "object") throw new Error("defineAgreement: config object required");

  if (typeof config.storage !== "function" && typeof config.storage !== "object") {
    errors.push("storage must be a function returning a storage adapter (or an adapter object)");
  }
  const baseUrlOk = typeof config.baseUrl === "string" || typeof config.baseUrl === "function";
  if (!baseUrlOk) errors.push("baseUrl must be a string or a function(req)");

  const secrets = config.secrets || {};
  if (!secrets.linkKey) errors.push("secrets.linkKey is required (32-byte key, base64)");
  if (!secrets.signSecret) errors.push("secrets.signSecret is required");

  const tenancy = config.tenancy || "single";
  if (!["single", "multi"].includes(tenancy)) errors.push('tenancy must be "single" or "multi"');
  if (tenancy === "multi" && typeof config.auth?.canManage !== "function") {
    errors.push('tenancy "multi" requires auth.canManage(req, agreement)');
  }
  if (config.pdf !== undefined && typeof config.pdf !== "function") {
    errors.push("pdf must be a function(url) returning a Buffer/Uint8Array");
  }

  if (errors.length) {
    throw new Error(`agreement config invalid:\n- ${errors.join("\n- ")}`);
  }

  return Object.freeze({
    ...config,
    tenancy,
    auth: Object.freeze({ ...(config.auth || {}) }),
    secrets: Object.freeze({ ...secrets }),
  });
}

export function assertAdmin(config, req) {
  if (typeof config.auth?.getAdmin !== "function") {
    const err = new Error("admin API is not configured: provide auth.getAdmin");
    err.status = 503;
    throw err;
  }
}

export function notReady() {
  const err = new Error(NOT_READY);
  err.status = 501;
  return err;
}
