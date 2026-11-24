/**
 * Deterministic source fingerprint for builds and e2e.
 *
 * Why not a commit id: this project must build and verify itself from a plain
 * folder copy, with no version-control metadata present. Hashing the actual
 * source files gives the same guarantee we care about — "the running build was
 * produced from exactly these files" — and works anywhere.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Directories whose contents define the application. */
export const SOURCE_DIRS = ["src", "packages/agreement/src", "prisma", "scripts"];

/** Single files that also change behaviour. */
export const SOURCE_FILES = [
  "package.json",
  "package-lock.json",
  "next.config.js",
  "next.config.mjs",
  "tsconfig.json",
  "postcss.config.js",
  "postcss.config.mjs",
  "tailwind.config.js",
  "components.json",
];

const SKIP = new Set(["node_modules", ".next", ".next-build", ".git", "export", "_backups"]);

function walk(root, rel, out) {
  const abs = path.join(root, rel);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(entry.name)) continue;
    const childRel = path.posix.join(rel.split(path.sep).join("/"), entry.name);
    if (entry.isDirectory()) walk(root, childRel, out);
    else if (entry.isFile()) out.push(childRel);
  }
}

/**
 * @param {string} root project root (defaults to cwd)
 * @returns {{ sourceHash: string, files: number }}
 */
export function computeSourceHash(root = process.cwd()) {
  const files = [];
  for (const dir of SOURCE_DIRS) walk(root, dir, files);
  for (const file of SOURCE_FILES) {
    if (fs.existsSync(path.join(root, file))) files.push(file);
  }
  const hash = crypto.createHash("sha256");
  for (const rel of files.sort()) {
    hash.update(rel.replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, rel)));
    hash.update("\0");
  }
  return { sourceHash: hash.digest("hex").slice(0, 16), files: files.length };
}
