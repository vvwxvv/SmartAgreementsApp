/**
 * Locate a Chromium/headless-shell binary without hard-coding one machine.
 *
 * Order: E2E_CHROME → CHROMIUM_BIN → Playwright cache for the current OS.
 * Returns null when nothing is found; callers decide whether that is fatal.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function candidatesInPlaywrightCache() {
  const home = os.homedir();
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(home, "Library", "Caches", "ms-playwright"), // macOS
    path.join(home, ".cache", "ms-playwright"), // Linux
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"), // Windows
  ].filter(Boolean);

  const layouts = [
    ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
    ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
    ["chrome-headless-shell-linux64", "chrome-headless-shell"],
    ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
  ];
  const appLayouts = [
    ["chrome-mac-arm64", path.join("Chromium.app", "Contents", "MacOS", "Chromium")],
    ["chrome-mac-x64", path.join("Chromium.app", "Contents", "MacOS", "Chromium")],
    ["chrome-linux64", "chrome"],
    ["chrome-win64", "chrome.exe"],
  ];

  const out = [];
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    const shells = entries.filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse();
    for (const dir of shells) {
      for (const [sub, bin] of layouts) out.push(path.join(root, dir, sub, bin));
    }
    const builds = entries.filter((n) => n.startsWith("chromium-")).sort().reverse();
    for (const dir of builds) {
      for (const [sub, bin] of appLayouts) out.push(path.join(root, dir, sub, bin));
    }
  }
  return out;
}

export function findBrowser(env = process.env) {
  for (const explicit of [env.E2E_CHROME, env.CHROMIUM_BIN]) {
    if (explicit && fs.existsSync(explicit)) return explicit;
  }
  for (const candidate of candidatesInPlaywrightCache()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
