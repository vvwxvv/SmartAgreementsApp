// scripts/import-local-to-mongo.mjs - Prisma-ready export -> MongoDB (Prisma Client).
// Dry run by default. --apply writes; duplicates (P2002) are skipped.
import fs from "node:fs";
import path from "node:path";
import { loadModels, toPrismaDoc, fromCsvValue } from "./lib/localToPrisma.mjs";
import {
  counterMaxCommand,
  decideAgreementConflict,
  decideSignerConflict,
  isP2002,
  refuseFresh,
  sameContent,
  shouldSkipDependent,
} from "./lib/importRules.mjs";

const args = process.argv.slice(2);
const from = (args.find((a) => a.startsWith("--from=")) || "--from=export").split("=")[1];
const only = (args.find((a) => a.startsWith("--collection=")) || "").split("=")[1];
const csvFile = (args.find((a) => a.startsWith("--csv=")) || "").split("=")[1];
const apply = args.includes("--apply");
const allowMerge = args.includes("--allow-merge");
const QUOTE = String.fromCharCode(34);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === QUOTE) {
        if (text[i + 1] === QUOTE) { cell += QUOTE; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === QUOTE) quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

function docsFromCsv(model, file) {
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  if (!rows.length) return [];
  const header = rows[0];
  const byName = new Map(model.fields.map((f) => [f.name, f]));
  return rows.slice(1).map((cells) => {
    const doc = {};
    try {
      header.forEach((h, i) => {
        const field = byName.get(h);
        if (!field) return;
        const v = fromCsvValue(field, cells[i]);
        if (v !== undefined) doc[h] = v;
      });
    } catch (e) {
      doc.__csvError = e.message;
    }
    return doc;
  });
}

const models = loadModels();
const ORDER = ["Agreement", "AgreementSigner", "SigningEvent", "Meta", "PartyInfo", "Counter", "AdminGate"];
const rank = (n) => { const i = ORDER.indexOf(n); return i === -1 ? 99 : i; };
const targets = (only ? [only] : Object.keys(models)).sort((a, b) => rank(a) - rank(b));
let total = 0;
let invalid = 0;

if (apply && !process.env.MONGODB_URL) {
  console.error("[import] --apply requires MONGODB_URL");
  process.exit(2);
}

let prisma = null;
if (apply) {
  try {
    prisma = new (await import("@prisma/client")).PrismaClient();
  } catch {
    console.error("[import] @prisma/client is not generated. Run: npm run db:generate");
    process.exit(2);
  }
}
if (prisma) {
  const existing = await prisma.agreement.count();
  if (refuseFresh(existing, allowMerge)) {
    console.error("[import] target already has " + existing + " agreement(s). This tool is for a fresh database.");
    console.error("[import] Re-run with --allow-merge only after a snapshot and a reviewed collision plan.");
    await prisma.$disconnect();
    process.exit(2);
  }
}

let created = 0;
let skipped = 0;
let skippedDependents = 0;
let counterRaised = 0;
let failed = 0;
const unavailableParentIds = new Set();

for (const name of targets) {
  const model = models[name];
  if (!model) continue;
  let docs = [];
  if (csvFile && name === only) docs = docsFromCsv(model, csvFile);
  else {
    const file = path.join(from, name + ".json");
    if (!fs.existsSync(file)) continue;
    docs = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  const valid = [];
  for (const doc of docs) {
    if (doc.__csvError) {
      invalid += 1;
      console.error("[import] " + name + " row: " + doc.__csvError);
      continue;
    }
    const m = toPrismaDoc(model, doc);
    if (m.errors.length) {
      invalid += 1;
      if (name === "Agreement" && doc._id) unavailableParentIds.add(String(doc._id));
      console.error("[import] " + name + " " + String(doc.id || doc._id || "?") + ": " + m.errors.join("; "));
    } else valid.push(m.value);
  }
  total += valid.length;
  console.log("[import] " + name + ": valid=" + valid.length + " invalid=" + (docs.length - valid.length));
  if (!apply) continue;
  if (name === "Counter") {
    // Atomic $max: an import must never lower live numbering progress.
    for (const data of valid) {
      await prisma.$runCommandRaw(counterMaxCommand(data));
      counterRaised += 1;
    }
    continue;
  }

  const client = prisma[name.charAt(0).toLowerCase() + name.slice(1)];
  for (const data of valid) {
    if (shouldSkipDependent(name, data, unavailableParentIds)) { skippedDependents += 1; continue; }
    try { await client.create({ data }); created += 1; }
    catch (e) {
      if (isP2002(e)) {
        if (name === "Agreement") {
          // Distinguish an idempotent re-run (_id exists) from a real collision.
          const existing = await prisma.agreement.findUnique({ where: { id: data.id } });
          const d = decideAgreementConflict(e, Boolean(existing), sameContent(existing, data));
          if (d.action === "skip-idempotent") { skipped += 1; }
          else { failed += 1; console.error("[import] Agreement " + data.number + ": " + d.reason); }
          unavailableParentIds.add(String(data.id));
        } else if (name === "AgreementSigner") {
          const d = decideSignerConflict(e);
          if (d.action === "fail") { failed += 1; console.error("[import] AgreementSigner " + data.email + ": " + d.reason); }
          else skipped += 1;
        } else skipped += 1;
      } else {
        failed += 1;
        if (name === "Agreement") unavailableParentIds.add(String(data.id));
        console.error("[import] " + name + " failed: " + (e && e.message));
      }
    }
  }
}

if (apply && prisma) {
  // renewalOf / renewedFrom are soft references; a dangling one is a broken
  // chain even though Mongo itself accepts it.
  const linked = await prisma.agreement.findMany({
    where: { OR: [{ renewalOf: { not: null } }, { renewedFrom: { not: null } }] },
    select: { id: true, number: true, renewalOf: true, renewedFrom: true },
  });
  for (const row of linked) {
    for (const field of ["renewalOf", "renewedFrom"]) {
      const ref = row[field];
      if (!ref) continue;
      const hit = await prisma.agreement.findUnique({ where: { id: ref }, select: { id: true } });
      if (!hit) {
        failed += 1;
        console.error("[import] Agreement " + row.number + ": " + field + " " + ref + " is not in the target");
      }
    }
  }
}

if (prisma) await prisma.$disconnect();
if (!apply) console.log("[import] dry run: valid=" + total + " invalid=" + invalid + ". Re-run with --apply.");
else console.log("[import] created=" + created + " skipped=" + skipped + " skippedDependents=" + skippedDependents + " counterRaised=" + counterRaised + " failed=" + failed);
if (invalid || failed) process.exitCode = 1;
