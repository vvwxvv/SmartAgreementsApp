/**
 * Server boot checks. Next runs this once when the server starts (not at build).
 *
 * The app no longer sends e-mail: the operator hands each signer a link + a
 * short access code by hand. So a public deployment only needs its secrets —
 * and it must have them. A missing link key would surface much later, as a
 * failure to send, so it is checked here instead.
 *
 * The helpers are loaded through Node's own resolver instead of `import`,
 * because bootChecks pulls in node:crypto (evidence signing) and Next also
 * bundles this hook for runtimes that have no `node:` scheme. The guard below
 * already limits the checks to the Node server; this keeps them out of the
 * other bundles instead of failing the build.
 */

function nodeRequire() {
  const mod = process.getBuiltinModule && process.getBuiltinModule("node:module");
  if (!mod || typeof mod.createRequire !== "function") return null;
  try {
    return mod.createRequire(process.cwd() + "/package.json");
  } catch {
    return null;
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const requireFromRoot = nodeRequire();
  if (!requireFromRoot) return;

  const { resolveDataSource, devMongoError, describeMongoTarget } = requireFromRoot("./src/lib/dataSource.js");
  const { productionProblems } = requireFromRoot("./src/lib/bootChecks.js");

  const { mode, resolved } = resolveDataSource();
  console.log("[agreement] data source: " + mode + " -> " + resolved + (resolved === "local" ? " (local files)" : " (remote database)"));
  if (resolved === "mongo") console.log("[agreement] database: " + describeMongoTarget());

  if (process.env.NODE_ENV === "production" && resolved === "local" && String(process.env.ALLOW_LOCAL_IN_PRODUCTION || "").trim() === "1") {
    console.warn("[agreement] WARNING: ALLOW_LOCAL_IN_PRODUCTION=1 — contracts are stored in local JSON files.");
    console.warn("[agreement] WARNING: this is for demos and e2e ONLY. Never use it for real contracts.");
  }

  if (process.env.NODE_ENV !== "production") {
    // DATA_SOURCE=mongo in dev is allowed — it is the explicit switch. Only an
    // implicit switch (auto + MONGODB_URL) is refused.
    const devError = devMongoError(mode, resolved, process.env);
    if (devError) throw new Error(devError);
    return;
  }

  const problems = productionProblems(process.env);
  if (problems.length) {
    throw new Error("[agreement] 启动检查失败：\n- " + problems.join("\n- "));
  }
}
