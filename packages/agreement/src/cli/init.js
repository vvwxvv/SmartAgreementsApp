import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CONFIG_FILE, SIGN_PAGE, SIGN_PRINT_PAGE, PRINT_PAGE, API_ROUTE } from "./templates.js";

const norm = (s) => s.replace(/\r\n/g, "\n").replace(/\s+$/, "");

function parseArgs(argv) {
  const opts = { cwd: process.cwd(), check: false, force: false, cmd: "init" };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") opts.check = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--cwd") opts.cwd = path.resolve(argv[++i]);
    else if (a.startsWith("--cwd=")) opts.cwd = path.resolve(a.slice(6));
    else if (!a.startsWith("-")) { if (["init", "doctor"].includes(a)) opts.cmd = a; else rest.push(a); }
  }
  return opts;
}

function detectAppRoot(cwd) {
  const srcApp = path.join(cwd, "src", "app");
  const app = path.join(cwd, "app");
  if (fs.existsSync(srcApp)) return { root: srcApp, style: "src/app" };
  if (fs.existsSync(app)) return { root: app, style: "app" };
  return null;
}

function plan(cwd) {
  const detected = detectAppRoot(cwd);
  if (!detected) {
    throw new Error("no app/ or src/app/ found; run this inside a Next.js App Router project");
  }
  const a = detected.root;
  const configFile = path.join(cwd, "lib", "agreement.js");
  const relConfig = (file) => {
    let rel = path.relative(path.dirname(file), configFile).replace(/\\/g, "/").replace(/\.js$/, "");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return rel;
  };
  const body = (template, file) => template.replaceAll("@/lib/agreement", relConfig(file));
  const items = [
    { file: path.join(a, "sign", "[token]", "page.jsx"), body: body(SIGN_PAGE, path.join(a, "sign", "[token]", "page.jsx")) },
    { file: path.join(a, "sign", "[token]", "print", "page.jsx"), body: body(SIGN_PRINT_PAGE, path.join(a, "sign", "[token]", "print", "page.jsx")) },
    { file: path.join(a, "print", "[id]", "page.jsx"), body: body(PRINT_PAGE, path.join(a, "print", "[id]", "page.jsx")) },
    { file: path.join(a, "api", "agreement", "[...path]", "route.js"), body: body(API_ROUTE, path.join(a, "api", "agreement", "[...path]", "route.js")) },
    { file: configFile, body: CONFIG_FILE, onlyIfMissing: true },
  ];
  return { detected, items };
}

function readIfExists(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

export function compilePlan(cwd) {
  const { detected, items } = plan(cwd);
  return {
    detected,
    entries: items.map((it) => {
      const current = readIfExists(it.file);
      const status = current === null ? "create" : norm(current) === norm(it.body) ? "same" : "conflict";
      return { ...it, current, status };
    }),
  };
}

function writeAtomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.agreement-tmp-${process.pid}`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, file);
}

export async function init({ cwd, check, force }) {
  const { detected, entries } = compilePlan(cwd);
  const conflicts = entries.filter((e) => e.status === "conflict");
  const pending = entries.filter((e) => e.status === "create");

  console.log(`app root: ${path.relative(cwd, detected.root) || "."} (${detected.style})`);
  for (const e of entries) {
    console.log(`  ${e.status.padEnd(8)} ${path.relative(cwd, e.file)}`);
  }

  if (check) {
    if (conflicts.length) {
      console.log("\ncheck: conflicts found; nothing was written");
      process.exitCode = 2;
    } else {
      console.log(`\ncheck: ${pending.length} file(s) would be created`);
    }
    return;
  }

  if (conflicts.length && !force) {
    console.error(`\nrefusing to overwrite ${conflicts.length} file(s); re-run with --force only after reviewing them`);
    process.exitCode = 2;
    return;
  }

  const written = [];
  try {
    for (const e of pending) {
      writeAtomic(e.file, e.body);
      written.push(e.file);
    }
  } catch (err) {
    for (const f of written) {
      try { fs.unlinkSync(f); } catch {}
    }
    throw new Error(`write failed, rolled back ${written.length} file(s): ${err.message}`);
  }

  console.log(`\ncreated ${pending.length} file(s)`);
  console.log("\nnext:");
  console.log("  1. edit lib/agreement.js (storage, secrets, auth)");
  console.log("  2. set AGREEMENT_BASE_URL, AGREEMENT_LINK_KEY, JWT_SECRET");
  console.log("  3. import \"@yourorg/agreement/styles.css\" in app/layout");
  console.log("  4. next.config: transpilePackages: [\"@yourorg/agreement\"]");
  console.log("  (middleware and .env were not touched)");
}

export async function doctor({ cwd }) {
  const detected = detectAppRoot(cwd);
  console.log(`app root: ${detected ? path.relative(cwd, detected.root) + " (" + detected.style + ")" : "NOT FOUND"}`);
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")); } catch {}
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  console.log(`package: ${pkg ? pkg.name || "(unnamed)" : "NOT FOUND"}`);
  console.log(`@yourorg/agreement: ${deps["@yourorg/agreement"] ? "declared" : "NOT INSTALLED"}`);
  for (const env of ["AGREEMENT_BASE_URL", "AGREEMENT_LINK_KEY", "JWT_SECRET"]) {
    console.log(`${env}: ${process.env[env] ? "set" : "missing"}`);
  }
  // Resolve from the host project, not from this CLI file.
  const req = createRequire(path.join(cwd, "package.json"));
  const has = (id) => { try { req.resolve(id); return true; } catch { return false; } };
  const mongo = has("mongodb");
  const pw = has("playwright-core");
  console.log(`optional mongodb: ${mongo ? "resolvable" : "not installed (fine unless using the mongo adapter)"}`);
  console.log(`optional playwright-core: ${pw ? "resolvable" : "not installed (PDF will return 501)"}`);
}

export async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.cmd === "doctor") return doctor(opts);
  return init(opts);
}
