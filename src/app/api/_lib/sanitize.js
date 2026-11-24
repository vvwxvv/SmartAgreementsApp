// src/app/api/_lib/sanitize.js
//
// Shared, JSON-aware record sanitizer for every CRUD shell
// (api_shell / api_id_shell / batch_api_shell).
//
// ── Why this exists ─────────────────────────────────────────────────────────
// The shells used to coerce every non-array field with `String(value)`. For a
// Prisma `Json?` column that turns a stored object into the literal string
// "[object Object]" and an array into "" — silently destroying the JSON on
// create and batch-edit (the edit shell happened to pass objects through, so
// the three shells disagreed). This helper applies one consistent policy:
//
//   jsonFields     → real JSON value  (notes / related_dream / … / mark)
//                    — JSON OR a raw string, never destroyed
//   arrayFields    → string arrays   (paragraphs / reflections / tag)
//   everything else→ String           (toggles/booleans, dates, years,
//                    numbers, selects, language, plain text — ALWAYS a string)
//
// `validFields` still gates which keys are ever written.

/** Parse a value that should be JSON, tolerating legacy stringified JSON. */
export function coerceJson(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const looksJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));
    if (looksJson) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return value; // keep the raw string rather than lose it
      }
    }
    return value;
  }
  return value; // already an object / array / number / boolean
}

/** Coerce anything to a Boolean (accepts true/false, "Yes"/"No", 1/0, …). */
export function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return false;
  return ["true", "yes", "1", "y", "on"].includes(String(value).trim().toLowerCase());
}

/** Coerce to a string[] (objects fall through untouched). */
export function coerceStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== null && item !== undefined && String(item).trim() !== "")
      .map((item) => (item !== null && typeof item === "object" ? item : String(item)));
  }
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Coerce ANYTHING to a string — the store-everything-as-text policy.
 * Booleans → "true"/"false", numbers → digits, objects → JSON text,
 * null/undefined/empty → "".
 */
export function coerceText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * @param {object} data - raw record
 * @param {object} CONF - shell config (uses validFields/arrayFields/jsonFields/…)
 * @returns {object} sanitized record (no _id / id)
 */
export function sanitizeRecord(data, CONF = {}) {
  const validFields = CONF.validFields || [];
  const arrayFields = CONF.arrayFields || [];
  const jsonFields = CONF.jsonFields || [];
  const booleanFields = CONF.booleanFields || [];
  const numberFields = CONF.numberFields || [];

  const out = {};

  Object.entries(data || {}).forEach(([key, value]) => {
    // Never let a client write Mongo internals or a raw id.
    if (key === "_id" || key === "id") return;
    if (validFields.length && !validFields.includes(key)) return;

    if (jsonFields.includes(key)) {
      out[key] = coerceJson(value);
      return;
    }
    if (arrayFields.includes(key)) {
      out[key] = coerceStringArray(value);
      return;
    }

    // Everything else is stored as a STRING — booleans/toggles, dates, years,
    // numbers, selects and plain text alike (only jsonFields stay structured).
    out[key] = coerceText(value);
  });

  return out;
}

export default sanitizeRecord;
