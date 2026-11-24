#!/usr/bin/env node
/**
 * scripts/pdf-baseline.mjs  (P2-0.5)
 *
 * Renders the print page of the fixture contracts AGR-2026-0022 / 0023 to PDF,
 * records page count + extracted text, and writes tests/baseline/pdf-baseline.json.
 *
 * Requires:
 *   CHROMIUM_BIN  path to a Chromium/Chrome headless binary (required)
 *   python + pypdf
 *   a production build in .next
 *
 * Starts a temporary "next start" against a COPY of src/data/collections on
 * LOCAL_DATA_DIR, so the real data is never written. Port: PDF_PORT or 3217.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { getFreePort } from './lib/free-port.mjs';

const repo = process.cwd();
const bin = process.env.CHROMIUM_BIN || '';
if (!bin || !fs.existsSync(bin)) {
  console.error('SKIPPED: CHROMIUM_BIN is not set to an existing binary');
  process.exit(2);
}
const distDir = process.env.NEXT_DIST_DIR || '.next';
if (!fs.existsSync(path.join(repo, distDir, 'BUILD_ID'))) {
  console.error('SKIPPED: no production build in ' + distDir + ' (run npm run build)');
  process.exit(2);
}

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

const { hmac, createPdfRenderer } = await import('../packages/agreement/src/core/index.js');

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'agreement-pdf-'));
const fixtureDir = path.join(repo, 'tests', 'fixtures', 'collections');
const liveDir = path.join(repo, 'src', 'data', 'collections');
const realDir = fs.existsSync(path.join(fixtureDir, 'Agreement.json')) ? fixtureDir : liveDir;
for (const f of fs.readdirSync(realDir)) {
  if (f.endsWith('.json')) await fsp.copyFile(path.join(realDir, f), path.join(tmp, f));
}

const port = await getFreePort();
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)], {
  cwd: repo,
  env: {
    ...process.env,
    DATA_SOURCE: 'local',
    LOCAL_DATA_DIR: tmp,
    // This server only ever reads a temp copy; the production guard must not
    // make the baseline unrunnable out of the box.
    ALLOW_LOCAL_IN_PRODUCTION: '1',
    JWT_SECRET: secret,
    NEXT_TELEMETRY_DISABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d.toString(); });
child.stderr.on('data', (d) => { serverLog += d.toString(); });

async function waitReady(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(base + '/verify');
      if (r.status === 200) return true;
    } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function pdfInfo(file) {
  const out = execFileSync('python', [path.join('scripts', 'pdf_extract.py'), file], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  return JSON.parse(out);
}

const agreements = JSON.parse(await fsp.readFile(path.join(tmp, 'Agreement.json'), 'utf8'));
const wanted = ['AGR-2026-0022', 'AGR-2026-0023'];
// Must match service.printKey: '<expMs>.<hmac(print:<id>:<exp>)>', 10 min TTL.
const printKeyFor = (id) => {
  const exp = Date.now() + 10 * 60 * 1000;
  return exp + '.' + hmac('print:' + id + ':' + exp, secret);
};
const render = createPdfRenderer({ baseUrl: () => base, printKey: printKeyFor, chromium: () => bin });

const result = { generatedAt: new Date().toISOString(), chromium: bin, baseUrl: base, items: [] };
try {
  const ok = await waitReady(60000);
  if (!ok) throw new Error('server did not become ready; log: ' + serverLog.slice(-800));
  for (const number of wanted) {
    const doc = agreements.find((a) => a.number === number);
    if (!doc) { result.items.push({ number, skipped: 'not in fixture' }); continue; }
    const id = String(doc._id);
    const { buf } = await render({}, id, number);
    const file = path.join(tmp, number + '.pdf');
    await fsp.writeFile(file, buf);
    const info = pdfInfo(file);
    const pngDir = path.join(repo, 'tests', 'baseline', 'png');
    const pngRaw = execFileSync('python', [path.join('scripts', 'pdf_to_png.py'), file, pngDir, number], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const png = JSON.parse(pngRaw);
    result.items.push({
      number,
      id,
      bytes: buf.length,
      pages: info.pages,
      textSha256: crypto.createHash('sha256').update(info.text).digest('hex'),
      text: info.text,
      pngs: png.files.map((f) => path.basename(f)),
    });
    console.log(number + ': pages=' + info.pages + ' bytes=' + buf.length + ' textChars=' + info.text.length);
  }
  const outDir = path.join(repo, 'tests', 'baseline');
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(path.join(outDir, 'pdf-baseline.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('wrote tests/baseline/pdf-baseline.json');
} finally {
  // Only our own child tree; on Windows child.kill() leaves Next workers alive.
  try { execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' }); }
  catch (e) { try { child.kill(); } catch (e2) {} }
  await new Promise((r) => setTimeout(r, 800));
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
