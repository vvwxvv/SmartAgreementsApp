#!/usr/bin/env node
/**
 * scripts/layout-gallery.mjs  (P2-1)
 *
 * Renders AGR-2026-0022 in:
 *   - legacy  (no layoutConfig) and compares it to tests/baseline/png/*
 *   - simple / formal / modern / cover (preview query, P2-1 only)
 *
 * Writes PDFs + page PNGs under tests/layouts and a summary JSON.
 * Requires CHROMIUM_BIN, a build in NEXT_DIST_DIR (default .next-build),
 * and python with pypdf/pymupdf/Pillow.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { getFreePort } from './lib/free-port.mjs';

const run = promisify(execFile);
const repo = process.cwd();
const bin = process.env.CHROMIUM_BIN || '';
const distDir = process.env.NEXT_DIST_DIR || '.next-build';
const port = await getFreePort();
const number = process.env.LAYOUT_CONTRACT || 'AGR-2026-0022';

if (!bin || !fs.existsSync(bin)) { console.error('SKIPPED: CHROMIUM_BIN is not set'); process.exit(2); }
if (!fs.existsSync(path.join(repo, distDir, 'BUILD_ID'))) { console.error('SKIPPED: no build in ' + distDir); process.exit(2); }

// A free port is requested from the OS; we never reuse a fixed one, and the
// script only ever terminates the child PID it started itself.

function readEnv() {
  const out = {};
  const p = path.join(repo, '.env');
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    out[t.slice(0, i)] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = readEnv();
const secret = process.env.JWT_SECRET || env.JWT_SECRET || env.AGREEMENT_SECRET || 'dev-only-secret-change-me';

const { hmac } = await import('../packages/agreement/src/core/index.js');

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'agreement-layout-'));
const fixtureDir = path.join(repo, 'tests', 'fixtures', 'collections');
const liveDir = path.join(repo, 'src', 'data', 'collections');
const override = process.env.LAYOUT_DATA_DIR;
const realDir = override
  ? path.resolve(override)
  : (fs.existsSync(path.join(fixtureDir, 'Agreement.json')) ? fixtureDir : liveDir);
for (const f of fs.readdirSync(realDir)) {
  if (f.endsWith('.json')) await fsp.copyFile(path.join(realDir, f), path.join(tmp, f));
}

const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)], {
  cwd: repo,
  env: {
    ...process.env,
    NEXT_DIST_DIR: distDir,
    DATA_SOURCE: 'local',
    LOCAL_DATA_DIR: tmp,
    JWT_SECRET: secret,
    PRINT_LAYOUT_PREVIEW: '1',
    NEXT_TELEMETRY_DISABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });

console.log('server: ' + base + ' (build ' + distDir + ')');
async function ready(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(base + '/verify'); if (r.status === 200) return true; } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function py(script, args) {
  return execFileSync('python', [path.join('scripts', script)].concat(args), {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
}

const outRoot = path.join(repo, 'tests', 'layouts', process.env.LAYOUT_OUT || '');
const pdfDir = path.join(outRoot, 'pdf');
const pngDir = path.join(outRoot, 'png');
await fsp.mkdir(pdfDir, { recursive: true });
await fsp.mkdir(pngDir, { recursive: true });

const allVariants = [
  { name: 'legacy', query: '' },
  { name: 'simple', query: '&layout=simple' },
  { name: 'formal', query: '&layout=formal' },
  { name: 'modern', query: '&layout=modern' },
  { name: 'cover', query: '&layout=cover' },
];
const variants = process.env.LAYOUT_ONLY
  ? allVariants.filter((v) => v.name === process.env.LAYOUT_ONLY)
  : allVariants;

const summary = { generatedAt: new Date().toISOString(), contract: number, chromium: bin, build: distDir, items: [], legacyCompare: [] };

try {
  if (!(await ready(60000))) throw new Error('server not ready: ' + log.slice(-600));
  console.log('server ready');
  const agreements = JSON.parse(await fsp.readFile(path.join(tmp, 'Agreement.json'), 'utf8'));
  const doc = agreements.find((a) => a.number === number);
  if (!doc) throw new Error('contract not found: ' + number);
  const id = String(doc._id);
  const key = hmac('print:' + id, secret);

  for (const v of variants) {
    const pdfPath = path.join(pdfDir, v.name + '.pdf');
    console.log('render ' + v.name);
    const url = base + '/print/' + id + '?k=' + encodeURIComponent(key) + v.query;
    await run(bin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
      '--virtual-time-budget=6000', '--print-to-pdf=' + pdfPath, url], { timeout: 90000 });
    const buf = await fsp.readFile(pdfPath);
    const info = JSON.parse(py('pdf_extract.py', [pdfPath]));
    const png = JSON.parse(py('pdf_to_png.py', [pdfPath, pngDir, v.name]));
    summary.items.push({
      name: v.name,
      pages: info.pages,
      bytes: buf.length,
      textSha256: crypto.createHash('sha256').update(info.text).digest('hex'),
      pngs: png.files.map((f) => path.basename(f)),
    });
    console.log(v.name + ': pages=' + info.pages + ' bytes=' + buf.length);
  }

  const baseline = JSON.parse(await fsp.readFile(path.join(repo, 'tests', 'baseline', 'pdf-baseline.json'), 'utf8'));
  const baseItem = baseline.items.find((i) => i.number === number);
  const legacy = summary.items.find((i) => i.name === 'legacy');
  const baselinePngs = baseItem && baseItem.pngs ? baseItem.pngs : [];

  for (const name of baselinePngs) {
    const a = path.join(repo, 'tests', 'baseline', 'png', name);
    const pageSuffix = (name.match(/-p\d+\.png$/) || [''])[0];
    const b = path.join(pngDir, 'legacy' + pageSuffix);
    if (!fs.existsSync(a) || !fs.existsSync(b)) {
      summary.legacyCompare.push({ page: name, ok: false, reason: 'missing png', a: fs.existsSync(a), b: fs.existsSync(b) });
      continue;
    }
    const cmp = JSON.parse(py('compare_png.py', [a, b, '0.002', '2.0']));
    summary.legacyCompare.push({ page: name, ...cmp });
  }

  summary.legacy = {
    pages: legacy.pages,
    baselinePages: baseItem ? baseItem.pages : null,
    textSha256: legacy.textSha256,
    baselineTextSha256: baseItem ? baseItem.textSha256 : null,
    textMatch: Boolean(baseItem && legacy.textSha256 === baseItem.textSha256),
  };

  await fsp.writeFile(path.join(outRoot, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary.legacy, null, 2));
  console.log('legacy png compare:', summary.legacyCompare.map((c) => c.page + ' ' + (c.ok ? 'ok' : 'FAIL') + ' diff=' + c.changedRatio).join(' | '));
  console.log('wrote tests/layouts/summary.json');
} finally {
  // On Windows child.kill() leaves the Next server (and its workers) alive,
  // which keeps the parent's stdio open and the process hangs forever.
  try { execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' }); }
  catch (e) { try { child.kill(); } catch (e2) {} }
  await new Promise((r) => setTimeout(r, 800));
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
