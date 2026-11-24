// scripts/e2e-manager.mjs - manager E2E in an ISOLATED data dir.
// In-process next start on a temp LOCAL_DATA_DIR + headless Chrome over CDP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { computeSourceHash } from './lib/source-hash.mjs';
import { findBrowser } from './lib/find-browser.mjs';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const STARTED_AT = new Date().toISOString();
const SOURCE = computeSourceHash(ROOT);
const BUILD_ID = fs.existsSync('.next/BUILD_ID') ? fs.readFileSync('.next/BUILD_ID', 'utf8').trim() : '';
const BUILD_INFO_PATH = '.next/BUILD_INFO.json';
const BUILD_META = fs.existsSync(BUILD_INFO_PATH) ? JSON.parse(fs.readFileSync(BUILD_INFO_PATH, 'utf8')) : null;
const BUILD_SOURCE = BUILD_META && BUILD_META.sourceHash ? BUILD_META.sourceHash : '';
const BUILD_FRESH = Boolean(BUILD_SOURCE) && BUILD_SOURCE === SOURCE.sourceHash;
console.log('[e2e] build=' + (BUILD_ID || 'unknown') + ' source=' + SOURCE.sourceHash + (BUILD_FRESH ? '' : ' (build is stale: rerun npm run build)'));
const SCRIPT_HASH = crypto.createHash('sha256').update(fs.readFileSync('scripts/e2e-manager.mjs')).digest('hex').slice(0, 12);
const DEV_STORE = path.join(ROOT, 'src', 'data', 'collections');
const PORT = Number(process.env.E2E_PORT || 4030);
const BASE = 'http://127.0.0.1:' + PORT;
const SHOTS = path.join(ROOT, 'docs', 'e2e');
const CHROME = findBrowser();
if (!CHROME) {
  console.error('[e2e] no Chromium found. Set E2E_CHROME (or CHROMIUM_BIN), or install the Playwright chromium headless shell.');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const SECRET_KEY = 'ADMIN_' + 'SESSION' + '_SECRET';
const SECRET = env[SECRET_KEY] || env.JWT_SECRET || '';
const PATTERN = String(env.PATTERN_UNLOCK_PASSWORD || '').split(',').map((s) => Number(s.trim())).filter(Number.isFinite);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agreement-e2e-'));
const DATA_DIR = path.join(TMP, 'collections');
fs.mkdirSync(DATA_DIR, { recursive: true });
const MASKED_STORE = '%TEMP%\\' + path.basename(path.dirname(DATA_DIR)) + '\\collections';

function assertIsolation() {
  const abs = path.resolve(DATA_DIR);
  if (abs === path.resolve(DEV_STORE)) throw new Error('refusing to run against the dev store');
  if (!abs.startsWith(path.resolve(os.tmpdir()))) throw new Error('E2E data dir must live under the OS temp dir');
  if (abs.startsWith(path.resolve(ROOT) + path.sep)) throw new Error('E2E data dir must be outside the repo');
}
assertIsolation();

const hashDir = (d) => {
  if (!fs.existsSync(d)) return 'missing';
  const h = crypto.createHash('sha256');
  for (const f of fs.readdirSync(d).sort()) h.update(f).update(fs.readFileSync(path.join(d, f)));
  return h.digest('hex').slice(0, 16);
};
const devHashBefore = hashDir(DEV_STORE);

/** Minimal valid signature PNG (100x60, inked) for API-level signing steps. */
function e2ePng() {
  const w = 100, h = 60, stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x += 1) {
      const o = y * (stride + 1) + 1 + x * 4;
      const ink = y > 20 && y < 40;
      raw[o] = ink ? 20 : 255; raw[o + 1] = ink ? 20 : 255; raw[o + 2] = ink ? 20 : 255; raw[o + 3] = 255;
    }
  }
  const table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    let c = 0xffffffff; for (const b of td) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}
const results = [];
const nodeCalls = [];
const consoleIssues = [];
let linkTokens = [];
const ok = (name, pass, detail, side) => results.push({ name, pass: Boolean(pass), detail: String(detail === undefined ? '' : detail), side: side || 'node' });

// Seed one already-expired contract. The server reads its store at boot, so
// this must be written BEFORE the child starts. Token hash must match the
// server algorithm: sha256(token), hex.
const E2E_EXPIRED_TOKEN = 'e2e-expired-token-000000000000';
const EXPIRED_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const EXPIRED_SIGNER_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const USE_MONGO = process.argv.includes('--mongo');
const MONGO_DB = 'agreement_e2e';
let mongoRepl = null;
let mongoClient = null;
let mongoUri = '';
{
  const past = new Date(Date.now() - 3 * 86400000).toISOString();
  const seededAgreement = {
    _id: EXPIRED_ID,
    number: 'AGR-2025-9001',
    createdById: 'e2e-seed',
    title: 'E2E 已过期合同',
    body: '<p>expired</p>',
    consentText: 'ok',
    status: 'SENT',
    contentHash: null,
    hashV: 2,
    revision: 0,
    signDeadline: past,
    expiresAt: past,
    sentAt: past,
    createdAt: past,
    updatedAt: past,
    parties: null,
    termMonths: null,
    termEnd: null,
    effectiveAt: null,
    renewedFrom: null,
    renewedBy: null,
    renewalStatus: null,
  };
  const seededSigner = {
    _id: EXPIRED_SIGNER_ID,
    agreementId: EXPIRED_ID,
    email: 'expired@example.com',
    label: 'Expired',
    order: 0,
    partyKey: null,
    accessTokenHash: crypto.createHash('sha256').update(E2E_EXPIRED_TOKEN).digest('hex'),
    signedAt: null,
    createdAt: past,
  };
  if (USE_MONGO) {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const { MongoClient, ObjectId } = await import('mongodb');
    mongoRepl = await MongoMemoryReplSet.create({
      binary: { version: process.env.MONGOMS_VERSION || '7.0.24' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    mongoUri = mongoRepl.getUri();
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    const db = mongoClient.db(MONGO_DB);
    await db.collection('Agreement').createIndex({ number: 1 }, { unique: true, name: 'number_unique' });
    await db.collection('Agreement').insertOne({
      ...seededAgreement,
      _id: new ObjectId(EXPIRED_ID),
      signDeadline: new Date(past),
      expiresAt: new Date(past),
      sentAt: new Date(past),
      createdAt: new Date(past),
      updatedAt: new Date(past),
    });
    await db.collection('AgreementSigner').insertOne({
      ...seededSigner,
      _id: new ObjectId(EXPIRED_SIGNER_ID),
      agreementId: new ObjectId(EXPIRED_ID),
      createdAt: new Date(past),
    });
  } else {
    fs.writeFileSync(path.join(DATA_DIR, 'Agreement.json'), JSON.stringify([seededAgreement], null, 2));
    fs.writeFileSync(path.join(DATA_DIR, 'AgreementSigner.json'), JSON.stringify([seededSigner], null, 2));
  }
}

// A previous failed run can leave a server bound to this port; talking to it
// silently mixes two data stores, so refuse instead of guessing.
try {
  const live = await fetch(BASE + '/api/meta', { signal: AbortSignal.timeout(1200) });
  if (live.status < 600) {
    console.error('[e2e] port ' + PORT + ' is already serving (stale process?). Stop it, or set E2E_PORT.');
    process.exit(1);
  }
} catch { /* free */ }

let server = null;
let chrome = null;
function killChildren() {
  try { if (chrome) chrome.kill('SIGKILL'); } catch { /* gone */ }
  try { if (server) server.kill('SIGKILL'); } catch { /* gone */ }
}
process.on('exit', killChildren);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { killChildren(); process.exit(130); });
}
const watchdog = setTimeout(() => {
  console.error('[e2e] timed out after 8 minutes; killing children.');
  killChildren();
  process.exit(2);
}, 8 * 60 * 1000);
watchdog.unref?.();

const serverEnv = Object.assign(
  {},
  process.env,
  USE_MONGO
    ? { DATA_SOURCE: 'mongo', MONGODB_URL: mongoUri, MONGODB_DB: MONGO_DB, PORT: String(PORT) }
    : {
        DATA_SOURCE: 'local',
        LOCAL_DATA_DIR: DATA_DIR,
        PORT: String(PORT),
        // next start runs with NODE_ENV=production; this run is an intentional,
        // isolated demo store, so the production guard needs the explicit override.
        ALLOW_LOCAL_IN_PRODUCTION: '1',
      }
);
server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'], env: serverEnv });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ready = false;
for (let i = 0; i < 150; i += 1) {
  await sleep(400);
  try { const r = await fetch(BASE + '/api/meta'); if (r.status < 600) { ready = true; break; } } catch (e) { /* not up */ }
}
ok('server boot (isolated store)', ready, ready ? 'ready' : serverLog.slice(-300));
if (ready && BUILD_ID) {
  const health = await fetch(BASE + '/api/health');
  const rid = health.headers.get('x-request-id') || '';
  ok('health endpoint + request id', health.status === 200 && /^[A-Za-z0-9._-]{8,64}$/.test(rid), 'status=' + health.status + ' rid=' + (rid || 'missing'), 'node');

  const probe = await fetch(BASE + '/verify');
  const probeHtml = await probe.text();
  // Next no longer guarantees the <!--id--> comment on every route; the id
  // still appears in the RSC payload. Checking anywhere in the document is
  // enough to prove the server is serving this build.
  ok('served build matches .next/BUILD_ID', probeHtml.indexOf(BUILD_ID) !== -1, 'build=' + BUILD_ID + ' status=' + probe.status, 'node');
  ok('build was produced from the current source tree', BUILD_FRESH, 'source=' + SOURCE.sourceHash + ' build=' + (BUILD_SOURCE || 'missing'), 'node');
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agreement-chrome-'));
chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9401', '--user-data-dir=' + profile, '--window-size=1440,1200', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
let wsUrl = '';
for (let i = 0; i < 100; i += 1) {
  await sleep(300);
  try { const r = await fetch('http://127.0.0.1:9401/json/version'); const j = await r.json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch (e) { /* not up */ }
}
ok('chrome + CDP', Boolean(wsUrl), wsUrl ? 'connected' : 'no websocket');

function maskPath(p) {
  return String(p)
    .replace(/^\/api\/sign\/[^/]+/, '/api/sign/{token}')
    .replace(/^\/sign\/[^/]+/, '/sign/{token}');
}
const requests = [];
let seq = 0;
const pending = new Map();
let ws = null;

function b64url(b) { let s = ''; const a = new Uint8Array(b); for (let i = 0; i < a.length; i += 1) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function adminCookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = 'v2.' + exp; // must match src/lib/adminAuth.js TOKEN_VERSION
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('admin:' + payload));
  return 'agreement_admin=' + payload + '.' + b64url(sig);
}

let sid = null;
const call = (method, params, sessionId) => new Promise((res) => {
  const id = ++seq; pending.set(id, res);
  ws.send(JSON.stringify({ id: id, method: method, params: params || {}, sessionId: sessionId }));
});
const evalx = async (expression) => {
  const r = await call('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true }, sid);
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const waitFor = async (expr, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await evalx(expr);
    if (v) return true;
    await sleep(200);
  }
  return false;
};

async function shot(name) {
  const r = await call('Page.captureScreenshot', { format: 'png' }, sid);
  if (r.result && r.result.data) {
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
    return true;
  }
  return false;
}

if (ready && wsUrl) {
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Network.requestWillBeSent') {
      try { const u = new URL(m.params.request.url); if (u.protocol !== 'http:' && u.protocol !== 'https:') { return; } const hdr = m.params.request.headers || {}; const rsc = String(hdr.RSC || hdr.rsc || '') === '1' || u.searchParams.has('_rsc'); requests.push({ id: m.params.requestId, method: m.params.request.method, path: maskPath(u.pathname), host: u.host, at: m.params.timestamp, post: m.params.request.postData || '', rsc }); } catch (e) { /* ignore */ }
    }
    if (m.method === 'Network.responseReceived') {
      const rec = requests.find((r) => r.id === m.params.requestId);
      if (rec) { rec.status = m.params.response.status; rec.type = m.params.type; rec.doneAt = m.params.timestamp; }
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (m.params.type === 'error' || /hydrat|did not match|server rendered html/i.test(text)) {
        consoleIssues.push(m.params.type + ': ' + text.slice(0, 200));
      }
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      consoleIssues.push('exception: ' + String((d.exception && d.exception.description) || d.text || '').slice(0, 200));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry && m.params.entry.level === 'error') {
      consoleIssues.push('log: ' + String(m.params.entry.text || '').slice(0, 200));
    }
  };

  const context = await call('Target.createBrowserContext', { disposeOnDetach: true });
  const browserContextId = context.result && context.result.browserContextId;
  ok('isolated browser context', Boolean(browserContextId), browserContextId || 'none');

  const target = await call('Target.createTarget', { url: 'about:blank', browserContextId: browserContextId });
  const attached = await call('Target.attachToTarget', { targetId: target.result.targetId, flatten: true });
  sid = attached.result.sessionId;
  await call('Page.enable', {}, sid);
  await call('Network.enable', {}, sid);
  await call('Runtime.enable', {}, sid);
  await call('Log.enable', {}, sid);

  const perm = await call('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: BASE, browserContextId: browserContextId }, sid);
  ok('clipboard permission', !perm.error, perm.error ? JSON.stringify(perm.error) : 'granted');

  const cookieHeader = await adminCookie();
  const cookieValue = cookieHeader.slice(cookieHeader.indexOf('=') + 1);
  const setc = await call('Network.setCookie', { name: 'agreement_admin', value: cookieValue, url: BASE + '/', httpOnly: true, sameSite: 'Lax' }, sid);
  ok('admin cookie set', setc.result && setc.result.success === true, JSON.stringify(setc.result || setc.error));

  await call('Page.navigate', { url: BASE + '/manager' }, sid);
  await sleep(2500);
  const unlockExpr = "fetch('/api/auth/pattern',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pattern:[" + PATTERN.join(',') + "]})}).then(r=>r.status).catch(e=>'ERR')";
  const unlock = await evalx(unlockExpr);
  ok('step1 pattern unlock', unlock === 200, 'status=' + unlock);

  await call('Page.navigate', { url: BASE + '/manager' }, sid);
  await waitFor("document.body.innerText.indexOf('MANAGEMENT')!==-1||document.body.innerText.indexOf('管理系统')!==-1", 15000);
  await waitFor("document.body.innerText.indexOf('AGR-2025-9001')!==-1", 15000);
  let text = (await evalx('document.body.innerText')) || '';
  const panel = /MANAGEMENT|管理系统/.test(text);
  // One expired contract is seeded at boot to exercise the expiry path, so the
  // list is not empty; assert the seeded row instead of the empty-state copy.
  const seededShown = /AGR-2025-9001/.test(text);
  const emptyShown = /暂无协议|No agreements yet/.test(text);
  ok('step1 panel shows the seeded expired contract', panel && seededShown && !emptyShown, 'panel=' + panel + ' seeded=' + seededShown + ' empty=' + emptyShown);
  ok('step1 screenshot', await shot('01-empty-state.png'), 'docs/e2e/01-empty-state.png');

  const uiParty = async (name, email) => {
    await evalx("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Parties|主体/.test(x.textContent));if(b){b.click();return 1}return 0})()");
    await sleep(700);
    await evalx("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/新建主体|New party/.test(x.textContent));if(b){b.click();return 1}return 0})()");
    await sleep(700);
    await evalx('window.__e2eName=' + JSON.stringify(name) + ';window.__e2eEmail=' + JSON.stringify(email) + ';1');
    return evalx("(()=>{const form=document.querySelector('form');if(!form)return 'no-form';const inputs=[...form.querySelectorAll('input')];const emailInput=form.querySelector('input[type=email]');const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};if(inputs[0])set(inputs[0],window.__e2eName);if(emailInput)set(emailInput,window.__e2eEmail);form.requestSubmit();return 'submitted';})()");
  };
  await uiParty('E2E 甲方', 'e2e-a@example.com');
  await sleep(1600);
  await uiParty('E2E 乙方', 'e2e-b@example.com');
  await sleep(1800);
  text = (await evalx('document.body.innerText')) || '';
  const partiesMade = /E2E 甲方/.test(text) && /E2E 乙方/.test(text);
  ok('step2 parties created through UI', partiesMade, partiesMade ? 'both visible' : text.replace(/\s+/g, ' ').slice(0, 150), 'browser');

  const api = async (p, opts) => {
    const init = Object.assign({ headers: { cookie: cookieHeader } }, opts || {});
    if (opts && opts.headers) init.headers = Object.assign({ cookie: cookieHeader }, opts.headers);
    const r = await fetch(BASE + p, init);
    nodeCalls.push({ method: (opts && opts.method) || 'GET', path: maskPath(p), status: r.status });
    const t = await r.text();
    let body = {}; try { body = JSON.parse(t); } catch (e) { /* not json */ }
    return { status: r.status, body: body };
  };

  const partyList = await api('/api/manager/party-info');
  const ids = {};
  for (const p of (partyList.body.parties || [])) if (p.name === 'E2E 甲方' || p.name === 'E2E 乙方') ids[p.name] = p.id;
  ok('step2 parties have ids from projection', Boolean(ids['E2E 甲方'] && ids['E2E 乙方']), JSON.stringify(Object.keys(ids)), 'node');

  const openForm = async () => {
    await evalx("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/协议|Agreements/.test(x.textContent));if(b){b.click();return 1}return 0})()");
    await sleep(600);
    return evalx("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/新建协议|New agreement/.test(x.textContent));if(b){b.click();return 'opened'}return 'notfound'})()");
  };
  const fillForm = async (title, send) => {
    await evalx('window.__t=' + JSON.stringify(title) + ';window.__s=' + (send ? '1' : '0') + ';window.__a=' + JSON.stringify(ids['E2E 甲方']) + ';window.__b=' + JSON.stringify(ids['E2E 乙方']) + ';1');
    return evalx("(()=>{const form=document.querySelector('form');if(!form)return 'no-form';const setV=(el,v,proto)=>{const s=Object.getOwnPropertyDescriptor(proto,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};const inputs=[...form.querySelectorAll('input')];const selects=[...form.querySelectorAll('select')];const ta=form.querySelector('textarea');if(inputs[0])setV(inputs[0],window.__t,window.HTMLInputElement.prototype);if(selects[0])setV(selects[0],window.__a,window.HTMLSelectElement.prototype);if(selects[1])setV(selects[1],window.__b,window.HTMLSelectElement.prototype);if(ta)setV(ta,'<h2>条款</h2><p>正文 RSCPROBE7391</p>',window.HTMLTextAreaElement.prototype);if(inputs[1])setV(inputs[1],'我已阅读并同意',window.HTMLInputElement.prototype);if(selects[2])setV(selects[2],String(window.__s)==='1'?'send':'draft',window.HTMLSelectElement.prototype);return 'filled';})()");
  };
  const waitText = async (needle, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const t = (await evalx('document.body.innerText')) || '';
      if (t.indexOf(needle) !== -1) return true;
      await sleep(250);
    }
    return false;
  };

  const opened1 = await openForm();
  const filled1 = opened1 === 'opened' ? await fillForm('E2E 草稿协议', false) : 'not-opened';
  await sleep(250);
  const submitted1 = filled1.indexOf('filled') === 0 ? await evalx("(()=>{const f=document.querySelector('form');if(!f)return 'no-form';const want=String(window.__s)==='1'?'send':'draft';const b=f.querySelector('[data-intent='+want+']');if(!b)return 'no-btn';b.click();window.__clicked=want+':'+b.textContent;return 'submitted';})()") : 'skipped';
  const sawDraft = await waitText('E2E 草稿协议', 8000);
  ok('step3 create draft through the UI form', opened1 === 'opened' && submitted1 === 'submitted' && sawDraft, opened1 + '/' + filled1 + '/' + submitted1 + '/' + sawDraft, 'browser');
  const textAfterDraft = (await evalx('document.body.innerText')) || '';
  ok('step3 first number is AGR-2026-0001', textAfterDraft.indexOf('AGR-2026-0001') !== -1, 'list shows 0001=' + (textAfterDraft.indexOf('AGR-2026-0001') !== -1), 'browser');

  const agList = await api('/api/manager/agreements');
  const draftRow = (agList.body.agreements || []).find((a) => a.title === 'E2E 草稿协议');
  ok('step3 draft persisted', Boolean(draftRow), draftRow ? draftRow.number + ' ' + draftRow.status : 'missing', 'node');
  const patch = await api('/api/manager/agreements/' + (draftRow ? draftRow.id : 'none'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'E2E 草稿协议（已改）' }) });
  ok('step4 draft is editable (200)', patch.status === 200, 'status=' + patch.status, 'node');

  const opened2 = await openForm();
  const filled2 = opened2 === 'opened' ? await fillForm('E2E 已发送协议', true) : 'not-opened';
  await sleep(250);
  const submitted2 = filled2.indexOf('filled') === 0 ? await evalx("(()=>{const f=document.querySelector('form');if(!f)return 'no-form';const want=String(window.__s)==='1'?'send':'draft';const b=f.querySelector('[data-intent='+want+']');if(!b)return 'no-btn';b.click();window.__clicked=want+':'+b.textContent;return 'submitted';})()") : 'skipped';
  const sawSent = await waitText('E2E 已发送协议', 9000);
  const clickedIntent = await evalx('window.__clicked || String(window.__s)');
  ok('step5 create+send through the UI form', opened2 === 'opened' && submitted2 === 'submitted' && sawSent, opened2 + '/' + filled2 + '/' + submitted2 + '/' + sawSent + ' s=' + String(await evalx('window.__s')) + ' click=' + clickedIntent, 'browser');
  const agList2 = await api('/api/manager/agreements');
  const sentRow = (agList2.body.agreements || []).find((a) => a.title === 'E2E 已发送协议');
  ok('step5 sent agreement is SENT', Boolean(sentRow) && sentRow.status === 'SENT', sentRow ? sentRow.number + ' ' + sentRow.status : 'missing', 'node');
  const sent = { body: { id: sentRow ? sentRow.id : 'none' } };
  const browserPosts = requests.filter((r) => r.method === 'POST' && r.path === '/api/manager/agreements' && r.status === 201).length;
  ok('step3/5 POSTs are in the browser log', browserPosts === 2, 'posts=' + browserPosts, 'browser');
  const frozen = await api('/api/manager/agreements/' + sent.body.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'nope' }) });
  ok('step6 sent agreement is frozen (409)', frozen.status === 409, 'status=' + frozen.status);

  const links = await api('/api/manager/agreements/' + sent.body.id + '/links');
  ok('step7 links endpoint 200', links.status === 200 && (links.body.links || []).length === 2, links.status + ' n=' + (links.body.links || []).length);
  const expectedUrl = (links.body.links || [])[0] ? links.body.links[0].url : '';
  linkTokens = (links.body.links || []).map((l) => { try { const u = new URL(l.url); return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || ''); } catch (e) { return ''; } }).filter(Boolean);
  ok('step7 tokens parsed from the links', linkTokens.length === 2 && linkTokens.every((t) => t.length === 43), 'n=' + linkTokens.length + ' lens=' + JSON.stringify(linkTokens.map((t) => t.length)), 'infra');
  const linksAgain = await api('/api/manager/agreements/' + sent.body.id + '/links');
  const urlsA = (links.body.links || []).map((l) => l.url).join('|');
  const urlsB = (linksAgain.body.links || []).map((l) => l.url).join('|');
  ok('step7 two /links calls return identical links', urlsA.length > 0 && urlsA === urlsB, 'same=' + (urlsA === urlsB) + ' n=' + (links.body.links || []).length, 'node');
  const signPage = expectedUrl ? await fetch(expectedUrl) : null;
  const signText = signPage ? await signPage.text() : '';
  const bogusToken = crypto.randomBytes(32).toString('base64url');
  const signBogus = await fetch(BASE + '/sign/' + bogusToken);
  const signValidStatus = signPage ? signPage.status : 'none';
  nodeCalls.push({ method: 'GET', path: '/sign/{token} (valid)', status: signValidStatus });
  nodeCalls.push({ method: 'GET', path: '/sign/{token} (bogus 43 chars)', status: signBogus.status });
  const apiValid = await fetch(BASE + '/api/sign/' + linkTokens[0]);
  const apiBogus = await fetch(BASE + '/api/sign/' + bogusToken);
  nodeCalls.push({ method: 'GET', path: '/api/sign/{token} (valid)', status: apiValid.status });
  nodeCalls.push({ method: 'GET', path: '/api/sign/{token} (bogus 43 chars)', status: apiBogus.status });
  const issuedHash = crypto.createHash('sha256').update(linkTokens[0] || '').digest('hex');
  let storedRows = [];
  if (USE_MONGO) {
    storedRows = await mongoClient.db(MONGO_DB).collection('AgreementSigner').find({}).toArray();
  } else {
    try { storedRows = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'AgreementSigner.json'), 'utf8')); } catch (e) { storedRows = []; }
  }
  const hashMatch = storedRows.some((r) => r.accessTokenHash === issuedHash);
  ok('step7 stored accessTokenHash matches the issued token', hashMatch, 'match=' + hashMatch + ' rows=' + storedRows.length + ' stored=' + JSON.stringify(storedRows.map((r) => String(r.accessTokenHash || '').slice(0, 8))) + ' computed=' + issuedHash.slice(0, 8), 'node');
  ok('step7 signer API accepts the real token, rejects a random one', apiValid.status === 200 && apiBogus.status === 404, 'api_valid=' + apiValid.status + ' api_bogus=' + apiBogus.status + ' page_valid=' + signValidStatus + ' page_bogus=' + signBogus.status, 'node');
  linkTokens = (links.body.links || []).map((l) => { try { const u = new URL(l.url); return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || ''); } catch (e) { return ''; } }).filter(Boolean);

  await call('Page.navigate', { url: BASE + '/manager' }, sid);
  await waitFor("document.body.innerText.indexOf('E2E 已发送协议')!==-1", 15000);
  await evalx("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Open|打开/.test(x.textContent));if(b){b.click();return 1}return 0})()");
  await waitFor("document.body.innerText.indexOf('签署方')!==-1||document.body.innerText.indexOf('Signers')!==-1", 12000);
  const clicked = await evalx("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Copy|复制/.test(x.textContent));if(b){b.click();return 'clicked'}return 'notfound'})()");
  await sleep(800);
  const clip = await evalx('navigator.clipboard.readText().then(t=>t).catch(e=>"ERR:"+e.name)');
  const clipOk = clicked === 'clicked' && clip === expectedUrl;
  ok('step7 clipboard read-back equals API link', clipOk, 'click=' + clicked + ' match=' + (clip === expectedUrl) + (String(clip).indexOf('ERR') === 0 ? ' ' + clip : ''));
  await evalx("(()=>{document.querySelectorAll('.ag-link-url').forEach((el)=>{el.textContent=el.textContent.replace(/[A-Za-z0-9_-]{12,}/g,'(masked)');});return 1})()");
  await sleep(200);
  ok('step7 screenshot', await shot('02-detail-links.png'), 'docs/e2e/02-detail-links.png');

  const detail = await api('/api/manager/agreements/' + sent.body.id);
  const raw = JSON.stringify(detail.body);
  const leak = /signatureImage|accessTokenEnc|accessTokenHash|codeHash|tsaToken/.test(raw);
  ok('step8 detail 200 without secrets', detail.status === 200 && !leak && (detail.body.signers || []).length === 2, 'status=' + detail.status + ' leak=' + leak + ' signers=' + (detail.body.signers || []).length);

  const anon = await fetch(BASE + '/api/manager/agreements');
  ok('step8 anonymous => 401', anon.status === 401, 'status=' + anon.status);
  const csrf = await fetch(BASE + '/api/manager/party-info', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' }, body: '{}' });
  ok('step8 foreign Origin => 403', csrf.status === 403, 'status=' + csrf.status);
  const big = await fetch(BASE + '/api/manager/party-info', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieHeader }, body: JSON.stringify({ name: 'x'.repeat(70000) }) });
  ok('step8 70KB body => 413', big.status === 413, 'status=' + big.status, 'node');
  const renewed = await api('/api/manager/agreements/' + sent.body.id + '/renew', { method: 'POST' });
  ok('step9 renew returns 201', renewed.status === 201 && Boolean(renewed.body.id), 'status=' + renewed.status, 'node');
  const orig = await api('/api/manager/agreements/' + sent.body.id);
  ok('step9 original shows renewing', orig.body.agreement && orig.body.agreement.renewalStatus === 'renewing', 'state=' + (orig.body.agreement && orig.body.agreement.renewalStatus), 'node');
  const renewedDetail = await api('/api/manager/agreements/' + renewed.body.id);
  ok('step9 renewal carries both signers', (renewedDetail.body.signers || []).length === 2, 'signers=' + (renewedDetail.body.signers || []).length, 'node');
  const cap = await api('/api/manager/agreements/' + sent.body.id + '/extend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signDeadline: new Date(Date.now() + 40 * 86400000).toISOString() }) });
  ok('step9 signing deadline is capped at 30 days', cap.status === 400, 'status=' + cap.status, 'node');

  const expiredView = await fetch(BASE + '/api/sign/' + E2E_EXPIRED_TOKEN);
  nodeCalls.push({ method: 'GET', path: '/api/sign/{expired}', status: expiredView.status });
  ok('step10 expired contract view is readable but not signable', expiredView.status === 200, 'status=' + expiredView.status, 'node');
  const expiredSubmit = await fetch(BASE + '/api/sign/' + E2E_EXPIRED_TOKEN + '/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  nodeCalls.push({ method: 'POST', path: '/api/sign/{expired}/submit', status: expiredSubmit.status });
  ok('step10 expired contract refuses signing', expiredSubmit.status === 409, 'status=' + expiredSubmit.status, 'node');
  const expiredExtend = await fetch(BASE + '/api/manager/agreements/' + EXPIRED_ID + '/extend', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieHeader }, body: JSON.stringify({ signDeadline: new Date(Date.now() + 5 * 86400000).toISOString() }) });
  nodeCalls.push({ method: 'POST', path: '/api/manager/agreements/{expired}/extend', status: expiredExtend.status });
  ok('step10 expired contract refuses extension', expiredExtend.status === 409, 'status=' + expiredExtend.status, 'node');
  const expiredDetail = await api('/api/manager/agreements/' + EXPIRED_ID);
  ok('step10 manager status is EXPIRED', expiredDetail.body.agreement && expiredDetail.body.agreement.status === 'EXPIRED', 'status=' + (expiredDetail.body.agreement && expiredDetail.body.agreement.status), 'node');

  // ── step12: decline stops the contract ────────────────────────────────
  const declineSent = await api('/api/manager/agreements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      partyA: ids['E2E 甲方'], partyB: ids['E2E 乙方'],
      title: 'E2E 拒签协议', body: '正文 {{partyA.name}}', send: true,
    }),
  });
  ok('step12 decline contract created', declineSent.status === 201 && declineSent.body.links && declineSent.body.links.length === 2, 'status=' + declineSent.status, 'node');
  const dTok = (declineSent.body.links || []).map((l) => l.url.split('/sign/')[1]);
  const dView = await api('/api/sign/' + dTok[0]);
  const declined = await api('/api/sign/' + dTok[0] + '/decline', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'E2E 价格条款不合' }),
  });
  ok('step12 decline accepted', declined.status === 200 && declined.body.declined === true, 'status=' + declined.status, 'node');
  const dAfter = await api('/api/sign/' + dTok[1]);
  ok('step12 other signer sees DECLINED and cannot sign', dAfter.body.canSign === false && dAfter.body.agreement && dAfter.body.agreement.status === 'DECLINED' && dAfter.body.agreement.declineReason === 'E2E 价格条款不合', 'status=' + (dAfter.body.agreement && dAfter.body.agreement.status) + ' canSign=' + dAfter.body.canSign, 'node');
  const dSubmit = await api('/api/sign/' + dTok[1] + '/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: e2ePng(), contentHash: dView.body.agreement && dView.body.agreement.contentHash }),
  });
  ok('step12 signing after decline is refused', dSubmit.status === 409, 'status=' + dSubmit.status, 'node');
  const dVerify = await api('/api/verify?number=' + encodeURIComponent(declineSent.body.number));
  ok('step12 public status is DECLINED', dVerify.body.status === 'DECLINED', 'status=' + dVerify.body.status, 'node');

  // ── step13: evidence package ──────────────────────────────────────────
  const evSent = await api('/api/manager/agreements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      partyA: ids['E2E 甲方'], partyB: ids['E2E 乙方'],
      title: 'E2E 证据包协议', body: '正文 {{partyA.name}}', send: true,
    }),
  });
  const evTokens = (evSent.body.links || []).map((l) => l.url.split('/sign/')[1]);
  for (const t of evTokens) {
    const v = await api('/api/sign/' + t);
    await api('/api/sign/' + t + '/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: e2ePng(), contentHash: v.body.agreement && v.body.agreement.contentHash }),
    });
  }
  const evRes = await fetch(BASE + '/api/manager/agreements/' + evSent.body.id + '/evidence', { headers: { cookie: cookieHeader } });
  const evBuf = Buffer.from(await evRes.arrayBuffer());
  nodeCalls.push({ method: 'GET', path: '/api/manager/agreements/{id}/evidence', status: evRes.status });
  const evText = evBuf.toString('latin1');
  const evNames = ['README.txt', 'manifest.json', 'agreement.pdf'].filter((n) => evText.indexOf(n) !== -1);
  ok('step13 evidence package is a ZIP with the expected files',
    evRes.status === 200 &&
    /application\/zip/.test(evRes.headers.get('content-type') || '') &&
    evBuf[0] === 0x50 && evBuf[1] === 0x4b &&
    evNames.length === 3 && evBuf.length > 1000,
    'status=' + evRes.status + ' bytes=' + evBuf.length + ' names=' + evNames.join(',') + ' ct=' + (evRes.headers.get('content-type') || ''), 'node');
  const evAnon = await fetch(BASE + '/api/manager/agreements/' + evSent.body.id + '/evidence');
  nodeCalls.push({ method: 'GET', path: '/api/manager/agreements/{id}/evidence (anon)', status: evAnon.status });
  ok('step13 evidence package requires admin', evAnon.status === 401, 'status=' + evAnon.status, 'node');

  // ── step14: attachments (draft only) ──────────────────────────────────
  const attDraft = await api('/api/manager/agreements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      partyA: ids['E2E 甲方'], partyB: ids['E2E 乙方'],
      title: 'E2E 附件协议', body: '正文 {{partyA.name}}', send: false,
    }),
  });
  const attBody = Buffer.from('annex for e2e').toString('base64');
  const up1 = await api(`/api/manager/agreements/${attDraft.body.id}/attachments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'annex.txt', mime: 'text/plain', data: attBody }),
  });
  ok('step14 attachment upload on a draft', up1.status === 201 && up1.body.attachments && up1.body.attachments.length === 1,
    'status=' + up1.status + ' n=' + ((up1.body.attachments || []).length), 'node');

  const attSent = await api(`/api/agreements/${attDraft.body.id}/send`, { method: 'POST' });
  ok('step14 draft with attachment can be sent', attSent.status === 200, 'status=' + attSent.status, 'node');
  const up2 = await api(`/api/manager/agreements/${attDraft.body.id}/attachments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'late.txt', mime: 'text/plain', data: attBody }),
  });
  ok('step14 attachments are frozen after sending', up2.status === 409, 'status=' + up2.status, 'node');

  const browserErrors = requests.filter((r) => r.status >= 400);
  ok('browser log has no 4xx/5xx', browserErrors.length === 0, browserErrors.map((r) => r.status + ' ' + r.path).join(', ') || 'none', 'browser');
  const printAnon = await fetch(BASE + '/print/' + sent.body.id);
  nodeCalls.push({ method: 'GET', path: '/print/{id} (no cookie, no key)', status: printAnon.status });
  ok('step8 /print unreadable without key', printAnon.status === 404, 'status=' + printAnon.status, 'node');
  const printCookie = await fetch(BASE + '/print/' + sent.body.id, { headers: { cookie: cookieHeader } });
  nodeCalls.push({ method: 'GET', path: '/print/{id} (cookie, no key)', status: printCookie.status });
  ok('step8 /print with cookie but no key still 404', printCookie.status === 404, 'status=' + printCookie.status, 'node');
  const rscPlain = await fetch(BASE + '/print/' + sent.body.id, { headers: { RSC: '1' } });
  const rscPlainText = await rscPlain.text();
  const rscPref = await fetch(BASE + '/print/' + sent.body.id, { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } });
  const rscPrefText = await rscPref.text();
  const signerEmails = ['e2e-a@example.com', 'e2e-b@example.com'];
  const agreementNumber = sentRow ? sentRow.number : '';
  const needles = ['E2E 已发送协议', 'RSCPROBE7391', agreementNumber, 'E2E 甲方', 'E2E 乙方'].concat(signerEmails).filter(Boolean);
  const leaksIn = (txt) => needles.filter((needle) => txt.indexOf(needle) !== -1);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'rsc-sample.txt'), rscPlainText.slice(0, 500) + '\n');
  const leakPlain = leaksIn(rscPlainText);
  const leakPref = leaksIn(rscPrefText);
  nodeCalls.push({ method: 'GET', path: '/print/{id} (RSC:1, no cookie, no key)', status: rscPlain.status });
  nodeCalls.push({ method: 'GET', path: '/print/{id} (RSC:1 + Next-Router-Prefetch:1)', status: rscPref.status });
  ok('step8 anonymous RSC payload has no contract data', leakPlain.length === 0, 'status=' + rscPlain.status + ' bytes=' + rscPlainText.length + ' leaks=' + (leakPlain.join('|') || 'none') + ' http404=' + /NEXT_HTTP_ERROR_FALLBACK/.test(rscPlainText), 'node');
  ok('step8 anonymous RSC+prefetch payload has no contract data', leakPref.length === 0, 'status=' + rscPref.status + ' bytes=' + rscPrefText.length + ' leaks=' + (leakPref.join('|') || 'none'), 'node');
  const authDetailText = JSON.stringify(detail.body);
  const missingInDetail = needles.filter((n) => authDetailText.indexOf(n) === -1);
  ok('positive control: authenticated detail carries every needle', missingInDetail.length === 0, 'missing=' + (missingInDetail.join('|') || 'none'), 'node');
  const http404Marker = /NEXT_HTTP_ERROR_FALLBACK/.test(rscPlainText);
  const markerLine = rscPlainText.split('\n').find((l) => l.indexOf('NEXT_HTTP_ERROR_FALLBACK') !== -1) || '';
  fs.writeFileSync(path.join(SHOTS, 'rsc-marker.txt'), markerLine + '\n');
  await evalx("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/×|关闭|Close/.test(x.textContent));if(b){b.click();return 1}return 0})()");
  await sleep(900);
  await call('Page.navigate', { url: BASE + '/sign/' + E2E_EXPIRED_TOKEN }, sid);
  await waitFor("document.body.innerText.indexOf('已到期')!==-1", 15000);
  const expiredPageText = (await evalx('document.body.innerText')) || '';
  const signButtons = await evalx("(()=>[...document.querySelectorAll('button')].filter(b=>/同意并签署/.test(b.textContent)).length)()");
  ok('step10 expired page shows 已到期 and no sign button', /已到期/.test(expiredPageText) && signButtons === 0, 'text=' + /已到期/.test(expiredPageText) + ' buttons=' + signButtons, 'browser');

  ok('step8 screenshot', await shot('03-agreements-list.png'), 'docs/e2e/03-agreements-list.png');

  // WeChat's in-app browser must be told to open a real browser.
  await call('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49' }, sid);
  await call('Page.navigate', { url: BASE + '/sign/' + linkTokens[0] }, sid);
  await waitFor("document.body.innerText.indexOf('在浏览器打开')!==-1", 15000);
  const wxText = (await evalx('document.body.innerText')) || '';
  ok('step11 WeChat UA shows the open-in-browser notice', /在浏览器打开/.test(wxText), 'shown=' + /在浏览器打开/.test(wxText), 'browser');

  await call('Target.disposeBrowserContext', { browserContextId: browserContextId });
}

const devHashAfter = hashDir(DEV_STORE);
ok('dev store untouched', devHashBefore === devHashAfter, devHashBefore + ' -> ' + devHashAfter);

const allPaths = requests.map((r) => r.path).concat(nodeCalls.map((n) => n.path));
const tokenLeaks = allPaths.filter((p) => /[A-Za-z0-9_-]{32,}/.test(p));
ok('log paths contain no token-like segments', tokenLeaks.length === 0, tokenLeaks.slice(0, 2).join(' ') || 'none', 'infra');
ok('no console errors or hydration warnings', consoleIssues.length === 0, consoleIssues.slice(0, 3).join(' | ') || 'none', 'browser');
const passed = results.filter((r) => r.pass).length;
const dir = path.join(ROOT, 'docs', 'e2e');
fs.mkdirSync(dir, { recursive: true });
const rows = ['# Manager E2E - request log', '', '- base: ' + BASE, '- data source: ' + (USE_MONGO ? 'mongo (' + MONGO_DB + ')' : 'local'), '- isolated store: ' + MASKED_STORE, '- captured: ' + new Date().toISOString(), '', '## A. Browser (CDP Network, same-origin page requests)', '', '| method | path | status | ms | rsc |', '|---|---|---|---|---|'];
for (const r of requests) {
  if (r.status === undefined) continue;
  const ms = r.doneAt && r.at ? Math.round((r.doneAt - r.at) * 1000) : '';
  rows.push('| ' + r.method + ' | ' + r.path + ' | ' + r.status + ' | ' + ms + ' | ' + (r.rsc ? 'RSC' : '') + ' |');
}
rows.push('', '## B. Node-side (fetch from the e2e process)', '', '| method | path | status |', '|---|---|---|');
for (const n of nodeCalls) rows.push('| ' + n.method + ' | ' + n.path + ' | ' + n.status + ' |');
rows.push('', '- Query strings are stripped before writing; tokens never reach the doc.');
const suffix = USE_MONGO ? '-mongo' : '';
fs.writeFileSync(path.join(dir, 'request-log' + suffix + '.md'), rows.join('\n') + '\n');

const resultsPath = path.join(dir, 'results' + (USE_MONGO ? '-mongo' : '') + '.json');
const meta = { sourceHash: SOURCE.sourceHash, buildSourceHash: BUILD_SOURCE, buildFresh: BUILD_FRESH, buildId: BUILD_ID, dataSource: USE_MONGO ? 'mongo' : 'local', scriptHash: SCRIPT_HASH, node: process.version, builtAt: BUILD_META ? BUILD_META.builtAt : null, startedAt: STARTED_AT, finishedAt: new Date().toISOString(), passed: passed, total: results.length, results: results, requests: requests.length, tokenLengths: linkTokens.map((t) => t.length), isolation: { before: devHashBefore, after: devHashAfter, untouched: devHashBefore === devHashAfter } };
fs.writeFileSync(resultsPath, JSON.stringify(meta, null, 2));

// Look for the tokens actually minted in this run, verbatim, in every artifact.
const artifactText = fs.readFileSync(path.join(dir, 'request-log' + (USE_MONGO ? '-mongo' : '') + '.md'), 'utf8') + fs.readFileSync(resultsPath, 'utf8');
const tokenHits = linkTokens.filter((t) => artifactText.indexOf(t) !== -1);
ok('artifacts contain no real link token', tokenHits.length === 0, 'tokens=' + linkTokens.length + ' hits=' + tokenHits.length, 'infra');

const finalPassed = results.filter((r) => r.pass).length;
meta.passed = finalPassed;
meta.total = results.length;
meta.results = results;
fs.writeFileSync(resultsPath, JSON.stringify(meta, null, 2));


console.log('PASSED=' + finalPassed + '/' + results.length);
for (const r of results) if (!r.pass) console.log('FAIL ' + r.name + ' :: ' + r.detail);
console.log('requests=' + requests.length);
const posts = requests.filter((r) => r.method === 'POST' && r.path === '/api/manager/agreements');
console.log('agreement_posts=' + posts.map((p) => (String(p.post).indexOf('"send":true') !== -1 ? 'send' : 'draft') + ':' + p.status).join(','));
console.log('dev_store=' + devHashBefore + '->' + devHashAfter);

try { if (ws) ws.close(); } catch (e) { /* closed */ }
chrome.kill('SIGKILL');
server.kill('SIGTERM');
await sleep(500);
try { server.kill('SIGKILL'); } catch (e) { /* exited */ }
try { if (mongoClient) { await mongoClient.db(MONGO_DB).dropDatabase(); await mongoClient.close(); } } catch (e) { /* closed */ }
try { if (mongoRepl) await mongoRepl.stop(); } catch (e) { /* stopped */ }
try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* locked */ }
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* locked */ }
clearTimeout(watchdog);
process.exit(results.every((r) => r.pass) ? 0 : 1);
