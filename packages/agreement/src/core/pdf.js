import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Prefer the headless shell: it never touches a desktop keychain or window
 *  server. Searches the Playwright cache for the current OS; set CHROMIUM_BIN
 *  to point at a system Chromium instead. */
export function findChromium(env = process.env) {
  if (env.CHROMIUM_BIN) return env.CHROMIUM_BIN;
  const home = os.homedir();
  const roots = [
    env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(home, "Library", "Caches", "ms-playwright"),
    path.join(home, ".cache", "ms-playwright"),
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "ms-playwright") : null,
  ].filter(Boolean);

  const layouts = [
    [["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
     ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
     ["chrome-headless-shell-linux64", "chrome-headless-shell"],
     ["chrome-headless-shell-win64", "chrome-headless-shell.exe"]],
    [["chrome-mac-arm64", path.join("Chromium.app", "Contents", "MacOS", "Chromium")],
     ["chrome-mac-x64", path.join("Chromium.app", "Contents", "MacOS", "Chromium")],
     ["chrome-linux64", "chrome"],
     ["chrome-win64", "chrome.exe"]],
  ];

  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    const shells = entries.filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse();
    const builds = entries.filter((n) => n.startsWith("chromium-")).sort().reverse();
    for (const [dirs, variant] of [[shells, 0], [builds, 1]]) {
      for (const dir of dirs) {
        for (const [sub, bin] of layouts[variant]) {
          const candidate = path.join(root, dir, sub, bin);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    }
  }
  return null;
}

/**
 * PDF rendering is injected, not imported: hosts without a Chromium binary can
 * still run every non-PDF route.
 */
export function createPdfRenderer({ baseUrl, printKey, chromium = findChromium } = {}) {
  if (typeof baseUrl !== "function") throw new Error("createPdfRenderer: baseUrl(req) is required");
  if (typeof printKey !== "function") throw new Error("createPdfRenderer: printKey(id) is required");

  /** Print /print/<id>?k=… to a PDF buffer. */
  return async function renderAgreementPdf(req, id, number) {
    const bin = typeof chromium === "function" ? chromium() : chromium;
    if (!bin) throw new Error("未找到 Chromium。请设置 CHROMIUM_BIN 或注入 chromium 路径");

    const url = `${baseUrl(req)}/print/${id}?k=${encodeURIComponent(printKey(id))}`;
    const out = path.join(os.tmpdir(), `agreement-${id}-${Date.now()}.pdf`);
    try {
      await run(
        bin,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--no-pdf-header-footer",
          "--virtual-time-budget=4000",
          `--print-to-pdf=${out}`,
          url,
        ],
        { timeout: 60000 }
      );
      const buf = fs.readFileSync(out);
      return { buf, filename: `${number || id}.pdf` };
    } finally {
      fs.unlink(out, () => {});
    }
  };
}
