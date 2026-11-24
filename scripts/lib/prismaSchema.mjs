// scripts/lib/prismaSchema.mjs - parse prisma/schema.prisma into a model map.
import fs from "node:fs";

export function parsePrismaSchema(file = "prisma/schema.prisma") {
  const text = fs.readFileSync(file, "utf8");
  const models = {};
  const re = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    const fields = [];
    for (const raw of m[2].split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const fm = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
      if (!fm) continue;
      const fname = fm[1];
      const ftype = fm[2];
      const arr = fm[3];
      const opt = fm[4];
      const attrs = fm[5] || "";
      fields.push({
        name: fname,
        type: ftype,
        list: Boolean(arr),
        optional: Boolean(opt) || Boolean(arr),
        isId: attrs.includes("@id"),
        objectId: attrs.includes("@db.ObjectId"),
        hasDefault: attrs.includes("@default"),
        updatedAt: attrs.includes("@updatedAt"),
      });
    }
    models[name] = { name, fields };
  }
  return models;
}
