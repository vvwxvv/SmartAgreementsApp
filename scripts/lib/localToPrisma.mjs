// scripts/lib/localToPrisma.mjs - pure mapping/validation against the schema.
import { parsePrismaSchema } from "./prismaSchema.mjs";

export const OBJECT_ID = /^[a-f0-9]{24}$/i;

function coerce(field, value, errors) {
  switch (field.type) {
    case "DateTime": {
      const d = value instanceof Date ? value : new Date(value);
      if (!Number.isFinite(d.getTime())) { errors.push(field.name + ": invalid date"); return undefined; }
      return d.toISOString();
    }
    case "Int":
    case "Float": {
      const n = Number(value);
      if (!Number.isFinite(n)) { errors.push(field.name + ": expected a number"); return undefined; }
      return n;
    }
    case "Boolean": return Boolean(value);
    case "Json": return value;
    case "String": {
      const s = String(value);
      if (field.objectId && !OBJECT_ID.test(s)) { errors.push(field.name + ": expected a 24-hex ObjectId string"); return undefined; }
      return s;
    }
    default: return value;
  }
}

/** Map a local document to a Prisma create payload.
 *  _id becomes id (Prisma maps it back to _id).
 *  Dates become ISO strings (Prisma accepts ISO-8601 for DateTime).
 *  ObjectId columns must be 24-hex strings.
 *  Unknown keys are an error unless strict:false.
 */
export function toPrismaDoc(model, doc, { strict = true } = {}) {
  const errors = [];
  const unknown = [];
  const out = {};
  const byName = new Map(model.fields.map((f) => [f.name, f]));
  const rawId = doc && (doc.id !== undefined ? doc.id : doc._id);

  for (const [key, value] of Object.entries(doc || {})) {
    if (key === "_id") continue;
    const field = byName.get(key);
    if (!field) { unknown.push(key); continue; }
    if (value === null || value === undefined) continue;
    out[key] = coerce(field, value, errors);
  }

  const idField = model.fields.find((f) => f.isId);
  if (rawId !== undefined && rawId !== null) {
    if (idField && idField.objectId) {
      const s = String(rawId);
      if (!OBJECT_ID.test(s)) errors.push("id: expected a 24-hex ObjectId string");
      else out.id = s;
    } else {
      out.id = String(rawId);
    }
  }

  for (const f of model.fields) {
    if (f.isId || f.optional || f.hasDefault || f.updatedAt) continue;
    if (out[f.name] === undefined) errors.push(f.name + ": required");
  }
  if (unknown.length && strict) errors.push("unknown fields: " + unknown.join(", "));
  return { value: out, errors, unknown };
}

export function loadModels(file) { return parsePrismaSchema(file); }

/** Coerce a CSV cell into the type the schema expects. */
export function fromCsvValue(field, raw) {
  const s = raw === undefined || raw === null ? "" : String(raw);
  // CSV cannot distinguish null from an empty cell. Empty means "not provided"
  // for every type; use JSON if you need an explicit null.
  if (s === "") return undefined;
  if (field.type === "Boolean") {
    const v = s.toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "y") return true;
    if (v === "false" || v === "0" || v === "no" || v === "n") return false;
    throw new Error(field.name + ': invalid boolean "' + s + '" (expected true/false/1/0/yes/no)');
  }
  if (field.type === "Int" || field.type === "Float") return s === "" ? undefined : Number(s);
  if (field.type === "Json") {
    if (s === "") return undefined;
    try { return JSON.parse(s); } catch { return s; }
  }
  return s;
}
