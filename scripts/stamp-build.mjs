// scripts/stamp-build.mjs — record which sources produced this build.
//
// The build id alone cannot prove provenance. We hash the actual source tree
// (src, packages/agreement/src, prisma, scripts + config files) so a build made
// from older or modified files is visible afterwards. No version control is
// required or consulted.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { computeSourceHash } from "./lib/source-hash.mjs";

const require = createRequire(import.meta.url);
const distDir = path.resolve(process.env.NEXT_DIST_DIR || ".next");
const { sourceHash, files } = computeSourceHash(process.cwd());

let nextVersion = "";
try {
  nextVersion = require("next/package.json").version;
} catch {
  /* next not resolvable: keep the field empty rather than fail the build */
}

const meta = {
  sourceHash,
  files,
  builtAt: new Date().toISOString(),
  node: process.version,
  next: nextVersion,
};

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, "BUILD_INFO.json"), JSON.stringify(meta, null, 2) + "\n");
console.log("[build] source=" + sourceHash + " files=" + files + (nextVersion ? " next=" + nextVersion : ""));
