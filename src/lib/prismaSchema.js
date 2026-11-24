/**
 * 读取 prisma/schema.prisma，作为数据文件的唯一契约。
 *
 * 只解析这个 schema 实际用到的子集：model 块、标量字段（String/Int/Boolean/
 * DateTime/Json）、可选标记 `?`、`@default(...)`、`@updatedAt`、`@map("_id")`、
 * `@db.ObjectId`。遇到不认识的类型直接报错——宁可停下来，也不要静默放过。
 */

const SCALARS = new Set(["String", "Int", "Boolean", "DateTime", "Json"]);

export function parsePrismaSchema(text) {
  const models = {};
  let cur = null;
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    const m = /^model\s+(\w+)\s*\{/.exec(line);
    if (m) { cur = { name: m[1], fields: {} }; models[m[1]] = cur; continue; }
    if (line === "}") { cur = null; continue; }
    if (!cur) continue;
    const f = /^(\w+)\s+(\w+)(\[\])?(\?)?(\s+.*)?$/.exec(line);
    if (!f) continue;
    const [, name, type, list, optional, attrs = ""] = f;
    if (!SCALARS.has(type) && !models[type]) {
      // 关系字段（本 schema 没有）或未知类型：明确失败，避免漏校验。
      if (!["String", "Int", "Boolean", "DateTime", "Json"].includes(type)) {
        throw new Error(`schema.prisma：model ${cur.name}.${name} 使用了未知类型 ${type}`);
      }
    }
    const hasDefault = /@default\(/.test(attrs);
    const updatedAt = /@updatedAt/.test(attrs);
    cur.fields[name] = {
      name,
      type,
      list: Boolean(list),
      optional: Boolean(optional) || hasDefault || updatedAt,
      hasDefault,
      updatedAt,
      objectId: /@db\.ObjectId/.test(attrs),
      mappedTo: (/@map\("([^"]+)"\)/.exec(attrs) || [])[1] || null,
    };
    if (cur.fields[name].mappedTo === "_id") cur.idField = name;
  }
  return models;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const HEX24 = /^[0-9a-f]{24}$/i;

/**
 * 严格校验一行 CSV 是否符合某个 model。
 * @returns {string[]} 错误列表（空数组 = 通过）
 */
export function validateRow(model, row, { line } = {}) {
  const errors = [];
  const where = line ? `第 ${line} 行` : "行";
  const fields = model.fields;
  for (const key of Object.keys(row)) {
    if (!fields[key]) {
      // id 是 Prisma 字段；_id 是导入时内部列，也允许出现在表头。
      if (key !== "_id") errors.push(`${where}：未知列 "${key}"（model ${model.name} 没有这个字段）`);
    }
  }
  for (const f of Object.values(fields)) {
    if (f.name === "id" && !row.id && row._id) continue;
    const raw = row[f.name];
    const empty = raw === undefined || raw === null || String(raw).trim() === "";
    if (empty) {
      if (!f.optional) errors.push(`${where}：必填字段 "${f.name}" 为空`);
      continue;
    }
    const v = String(raw).trim();
    if (f.type === "Int" && !/^-?\d+$/.test(v)) errors.push(`${where}："${f.name}" 应为整数，得到 "${v}"`);
    if (f.type === "Boolean" && !/^(true|false|1|0)$/i.test(v)) errors.push(`${where}："${f.name}" 应为 true/false`);
    if (f.type === "DateTime" && !(ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)))) {
      errors.push(`${where}："${f.name}" 不是合法日期（要 ISO 8601），得到 "${v}"`);
    }
    if (f.type === "Json") {
      try { JSON.parse(v); } catch { errors.push(`${where}："${f.name}" 不是合法 JSON`); }
    }
    if (f.objectId && !HEX24.test(v)) errors.push(`${where}："${f.name}" 应为 24 位 ObjectId，得到 "${v}"`);
    if (f.name === "id" && f.objectId && !HEX24.test(v)) errors.push(`${where}：id 应为 24 位 ObjectId，得到 "${v}"`);
  }
  return errors;
}

/** 把一行 CSV 转成存储文档：id → _id，类型按 schema 转换，空字符串 → 不写。 */
export function rowToDoc(model, row, { newId } = {}) {
  const doc = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "_id") continue;
    const f = model.fields[key];
    if (!f) continue;
    const raw = value === undefined || value === null ? "" : String(value).trim();
    if (raw === "") continue;
    let v = raw;
    if (f.type === "Int") v = Number(raw);
    else if (f.type === "Boolean") v = /^(true|1)$/i.test(raw);
    else if (f.type === "DateTime") v = new Date(raw).toISOString();
    else if (f.type === "Json") v = JSON.parse(raw);
    doc[f.name === "id" ? "_id" : f.name] = v;
  }
  if (!doc._id && model.fields.id) {
    const mapped = model.fields.id.objectId;
    doc._id = mapped ? newId() : (row.id || newId());
  }
  return doc;
}

/** 生成 24 位十六进制（与 ObjectId 字符串兼容，不依赖 bson 包）。 */
export function objectIdLike() {
  const hex = "0123456789abcdef";
  let out = Math.floor(Date.now() / 1000).toString(16).padStart(8, "0");
  for (let i = 0; i < 16; i += 1) out += hex[Math.floor(Math.random() * 16)];
  return out;
}
