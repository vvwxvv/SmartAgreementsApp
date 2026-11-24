// src/app/api/_lib/authz.js
//
// Central server-side access control for the shell's API surface.
//
// Principle: DENY BY DEFAULT. Every protected request is authorized BEFORE any
// protected business-data access or side effect. A client-side gate (the
// manager pattern lock) is NOT server protection and is never consulted here.
//
// The ONLY data access allowed before authorization is auth's own session/user
// lookup (see _authUtils.getUserById); guarded handlers never reach their
// collection's DB work unless authorize() returned allow.
//
// Failure semantics (generic bodies; no secret names, stack or DB detail):
//   401 UNAUTHENTICATED   missing / invalid / expired credentials
//   403 FORBIDDEN         identity valid, manager permission missing
//   404 NOT_FOUND         route/method not classified (closed) -> invisible
//   405 METHOD_NOT_ALLOWED known path, method not classified
//   503 AUTH_UNAVAILABLE  auth runtime config missing/broken
//
// "Anonymous reachable" (a public entry point) NEVER means "credential-free
// success": login/verify/refresh still validate the submitted credential.

import {
  assertAuthConfig,
  extractToken,
  verifyToken,
  getUserById,
} from '@/app/api/auth/_authUtils';
import { getMarkHide, getMarkFlags } from '@/utils/mediaMarks';

export const POLICY = Object.freeze({
  PUBLIC: 'public',
  AUTH: 'auth',
  MANAGER: 'manager',
});

const NO_STORE = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

// ── Generic, non-leaking responses ───────────────────────────────────────────
export const denyUnauthenticated = () =>
  new Response(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'Authentication required' }),
    { status: 401, headers: NO_STORE });
export const denyForbidden = () =>
  new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'Insufficient permission' }),
    { status: 403, headers: NO_STORE });
export const denyNotFound = () =>
  new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Not found' }),
    { status: 404, headers: NO_STORE });
export const denyMethodNotAllowed = () =>
  new Response(JSON.stringify({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }),
    { status: 405, headers: NO_STORE });
export const denyBadRequest = (message = 'Bad request') =>
  new Response(JSON.stringify({ code: 'BAD_REQUEST', message }),
    { status: 400, headers: NO_STORE });
export const denyAuthUnavailable = () =>
  new Response(JSON.stringify({ code: 'AUTH_UNAVAILABLE', message: 'Authentication is unavailable' }),
    { status: 503, headers: NO_STORE });

// ── Manager identity ─────────────────────────────────────────────────────────
// A manager is a *real, current* user whose role is in the manager set. The
// role is read from the DB record (not merely decoded from the token), so a
// revoked/role-changed account stops being a manager immediately.
const DEFAULT_MANAGER_ROLES = ['admin', 'manager', 'owner'];
export function managerRoles() {
  const raw = process.env.SHELL_MANAGER_ROLES;
  const list = (raw ? raw.split(',') : DEFAULT_MANAGER_ROLES)
    .map((r) => String(r).trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : DEFAULT_MANAGER_ROLES.slice();
}
export function isManager(user) {
  if (!user) return false;
  const role = String(user.role || '').trim().toLowerCase();
  return role !== '' && managerRoles().includes(role);
}

// ── Policy table: route template × method → policy ───────────────────────────
// Anything not listed here is CLOSED (404). `[id]` matches one path segment.
const PUBLIC = POLICY.PUBLIC;
const AUTH = POLICY.AUTH;
const MANAGER = POLICY.MANAGER;

const TABLE = {};
function set(path, methods) {
  TABLE[path] = { ...(TABLE[path] || {}), ...methods };
}

// Public content collections (readable anonymously, written by managers only).
const CONTENT = [
  'about', 'artwork', 'bibliography', 'event', 'exhibition', 'fair',
  'gallery-contact', 'image', 'video', 'web', 'writing',
];
for (const c of CONTENT) {
  set(`/api/${c}`, { GET: PUBLIC, POST: MANAGER, PUT: MANAGER, DELETE: MANAGER });
  set(`/api/${c}/[id]`, { GET: PUBLIC, PUT: MANAGER, DELETE: MANAGER });
}
set('/api/writing/years', { GET: PUBLIC });

// Reorder + sync (manager-only; they read/write whole records).
for (const c of ['artwork', 'event', 'exhibition', 'fair', 'image']) {
  set(`/api/${c}/reorder`, { GET: MANAGER, POST: MANAGER });
}
set('/api/image/sync', { POST: MANAGER });

// Batch edit (manager-only). Every collection exposes GET+PUT; writing also
// carries POST/DELETE.
for (const c of ['about', 'bibliography', 'event', 'exhibition', 'fair',
  'gallery-contact', 'image', 'subscribe', 'users', 'video', 'web', 'writing']) {
  set(`/api/${c}/batch_edit`, { GET: MANAGER, PUT: MANAGER });
}
set('/api/writing/batch_edit', { POST: MANAGER, DELETE: MANAGER });

// Public submissions: CREATE is anonymous, every read/update/delete is manager.
set('/api/enquire', { GET: MANAGER, POST: PUBLIC, PUT: MANAGER, DELETE: MANAGER });
set('/api/subscribe', { GET: MANAGER, POST: PUBLIC, PUT: MANAGER, DELETE: MANAGER });
set('/api/subscribe/[id]', { GET: MANAGER, PUT: MANAGER, DELETE: MANAGER });

// Auth endpoints. Reachable without an existing *admin* session, but each one
// still validates the credential it is given; GET on the others stays closed.
set('/api/auth/login', { POST: PUBLIC, GET: 'closed' }); // anon may submit credentials; all other methods closed
set('/api/auth/verify', { GET: AUTH });        // must verify the submitted token
set('/api/auth/refresh', { POST: AUTH });      // must verify the refresh credential
set('/api/auth/logout', { POST: AUTH, GET: AUTH }); // caller's own session only

// Site meta: public subset readable; writes manager-only.
set('/api/meta', { GET: PUBLIC, PUT: MANAGER, POST: MANAGER });

// Form settings (per-form field visibility / required / order). Internal
// manager configuration — never public, never readable by non-managers.
set('/api/form-settings', { GET: MANAGER, PUT: MANAGER, POST: MANAGER, DELETE: MANAGER });

// Standalone / infrastructure handlers (must be covered even though they do not
// pass through the CRUD shells).
set('/api/proxy', { GET: MANAGER });                       // outbound fetch (SSRF surface)
set('/api/upload', { POST: MANAGER, GET: MANAGER, OPTIONS: PUBLIC });

/** Registry view (for docs/tests). */
export function policyTable() {
  return JSON.parse(JSON.stringify(TABLE));
}
export function isClassified(path, method) {
  return Boolean(TABLE[path] && TABLE[path][String(method).toUpperCase()]);
}
export function templateFor(pathname) {
  const clean = ('/' + String(pathname || '').replace(/^\/+|\/+$/g, '')) || '/';
  if (TABLE[clean]) return clean;
  const i = clean.lastIndexOf('/');
  if (i > 0) {
    const candidate = `${clean.slice(0, i)}/[id]`;
    if (TABLE[candidate]) return candidate;
  }
  return null;
}

/** Resolve { pathname, method, template, policy } for a request (no side effects). */
export function policyForRequest(request) {
  let pathname = '/';
  try { pathname = new URL(request.url).pathname; } catch { /* keep '/' */ }
  const method = String(request.method || 'GET').toUpperCase();
  const template = templateFor(pathname);
  if (!template) return { pathname, method, template: null, policy: 'closed' };
  const policy = (TABLE[template] && TABLE[template][method]) || 'closed';
  return { pathname, method, template, policy };
}

// ── Authentication (auth's own lookup is the only pre-authz DB access) ───────
async function authenticate(request) {
  try {
    assertAuthConfig();                // missing/bad auth config → 503, never open
  } catch {
    return { error: denyAuthUnavailable() };
  }

  let token = null;
  try { token = extractToken(request); } catch { token = null; }
  if (!token) return { error: denyUnauthenticated() };

  let payload = null;
  try { payload = verifyToken(token); } catch { payload = null; }
  if (!payload || !payload.id) return { error: denyUnauthenticated() };

  let user = null;
  try {
    user = await getUserById(payload.id);
  } catch {
    return { error: denyAuthUnavailable() };
  }
  if (!user) return { error: denyUnauthenticated() };
  return { user, token, payload };
}

/**
 * Authorize a request. Returns either { denied: Response, ... } or
 * { denied: null, policy, template, user? }.
 */
export async function authorize(request) {
  const { method, template, policy } = policyForRequest(request);

  if (!template) return { denied: denyNotFound(), policy: 'closed', template: null };
  if (policy === 'closed') return { denied: denyMethodNotAllowed(), policy, template };
  if (policy === PUBLIC) return { denied: null, policy, template, user: null };

  const auth = await authenticate(request);
  if (auth.error) return { denied: auth.error, policy, template, user: null };
  if (policy === MANAGER && !isManager(auth.user)) {
    return { denied: denyForbidden(), policy, template, user: auth.user };
  }
  return { denied: null, policy, template, user: auth.user };
}

/** Thin wrapper: a Response to return, or null to continue. */
export async function enforce(request) {
  return (await authorize(request)).denied;
}

// ── Public response projection (field + record level) ────────────────────────
// Field allowlist per public collection. Internal fields are never returned:
// mark, work_value, sold, status, password/role/permissions, timestamps.
export const PUBLIC_FIELDS = Object.freeze({
  about: ['portrait_image_url', 'artist', 'caption', 'introductions', 'pdf_url', 'web_url', 'language', 'order'],
  artwork: ['cover_img_url', 'related_gallery_exhibition', 'artist', 'title', 'type', 'medium', 'year', 'size',
    'series', 'caption', 'duration', 'credits', 'special_thanks', 'introduction', 'video_url', 'web_url',
    'order', 'language'],
  bibliography: ['related_gallery_exhibition', 'related_artist', 'title', 'subtitle', 'cover_img_url', 'author',
    'type', 'year', 'date', 'published_at', 'pdf_url', 'web_url', 'video_url', 'order', 'language'],
  event: ['cover_img_url', 'title', 'subtitle', 'year', 'date_time', 'type', 'host', 'support', 'special_thanks',
    'venue', 'address', 'caption', 'introduction', 'related_artist', 'web_url', 'video_url', 'order', 'language'],
  exhibition: ['cover_img_url', 'title', 'subtitle', 'type', 'date_start', 'date_end', 'opening_date', 'year',
    'venue', 'location', 'curator', 'organiser', 'participating_artists', 'caption', 'description', 'introduction',
    'press_release', 'related_artwork', 'related_gallery_artist', 'video_url', 'web_url', 'language', 'order'],
  fair: ['title', 'section', 'type', 'date_start', 'date_end', 'vip_preview_date', 'year', 'booth', 'venue',
    'location', 'organiser', 'curator', 'participating_artists', 'caption', 'press_release',
    'related_artwork_title', 'related_gallery_artist', 'cover_img_url', 'web_url', 'video_url', 'language', 'order'],
  'gallery-contact': ['gallery_name', 'opening_time', 'email', 'phone', 'address', 'social_media', 'web_url', 'language'],
  image: ['img_url', 'type', 'tag_en', 'tag_cn', 'caption_en', 'caption_cn', 'tag_source', 'order'],
  video: ['video_url', 'cover_img_url', 'type', 'tag_en', 'tag_cn', 'caption_en', 'caption_cn', 'order'],
  web: ['web_url', 'cover_img_url', 'type', 'tag_en', 'tag_cn', 'caption_en', 'caption_cn', 'order'],
  writing: ['cover_img_url', 'author', 'title', 'subtitle', 'summary', 'keywords', 'category', 'type', 'year',
    'paragraphs', 'caption', 'tag', 'language'],
});

// Public subset of the singleton Meta document: presentation/SEO only. The
// gallery/entity mapping and form-type options are internal and never sent.
export const PUBLIC_META_KEYS = Object.freeze([
  'title', 'description', 'keywords', 'og_image', 'icon', 'manifest', 'canonical',
  'footer', 'menu', 'seo',
  // App identity + footer rendered by the standalone pages. These are
  // presentation strings only; nothing here is operational or personal.
  'app_title_en', 'app_title_cn',
  'app_footer_en', 'app_footer_cn', 'app_footer_start_year',
  'app_footer_rights_en', 'app_footer_rights_cn',
]);
export function projectMeta(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = {};
  for (const k of PUBLIC_META_KEYS) {
    if (Object.prototype.hasOwnProperty.call(doc, k)) out[k] = doc[k];
  }
  return out;
}

// Input allowlist for the anonymous create endpoints (separate from the full
// manager field set so an anonymous submitter cannot set status/index fields).
export const PUBLIC_SUBMIT_FIELDS = Object.freeze({
  enquire: ['name', 'email', 'phone', 'message', 'related_artwork_title', 'related_gallery_artist'],
  subscribe: ['name', 'email'],
});

// Record-level visibility is TWO independent gates, applied in this order:
//   1. GLOBAL public eligibility  (this section)
//   2. PAGE display eligibility   (PAGE_CONTEXTS below)
// The page gate can only narrow the global set; it never widens access.
//
// `status` is model-specific (exhibition = run state; fair/writing = publish
// state), so public eligibility is an EXPLICIT per-model allow-list of the
// values that EXIST in the corpus. ANY other value — including `draft`, an
// unknown value, or a future value — is NON-PUBLIC (default-deny). Empty
// string, explicit `null` and MISSING are three distinct cases, approved per
// model only. Values are normalised (trim + lower-case) before matching.
// No content-model change is needed: this maps the values already stored.
// A `SHELL_STATUS_POLICY` override (JSON) may replace the map for tests; if it
// is present but invalid, gated models DENY — there is no fallback to a looser
// rule (in particular, never "only exclude draft").
const STATUS_POLICY_BY_MODEL = Object.freeze({
  // exhibition: run-state values — APPROVED by review.
  exhibition: { allow: ['已结束', 'past', '进行中', 'current'], empty: false, nil: false, missing: false },
  // fair: historical empty string — APPROVED by review.
  fair:       { allow: [], empty: true, nil: false, missing: false },
  // writing: NOT approved yet. Corpus values (`DRAFT`, `""`, missing) were
  // shown to EXIST, but the public Writing list applies NO status rule today, so
  // existence is not a publication rule. Per review, unconfirmed categories stay
  // NON-PUBLIC — the value list is supplied for approval, not assumed.
  writing:    { allow: [], empty: false, nil: false, missing: false },
});
const STATUS_PENDING_CONFIRMATION = Object.freeze(['writing']);
const STATUS_GATED = new Set(Object.keys(STATUS_POLICY_BY_MODEL));

const normStatus = (v) => (typeof v === 'string' ? v : '').trim().toLowerCase();
const stripDraft = (list) => [...new Set(list.map(normStatus).filter((s) => s && s !== 'draft'))];

function resolveStatusPolicy() {
  const raw = process.env.SHELL_STATUS_POLICY;
  if (!raw) return { policy: STATUS_POLICY_BY_MODEL, source: 'builtin', valid: true };
  try {
    const models = JSON.parse(raw).models;
    if (!models || typeof models !== 'object') throw new Error('shape');
    const policy = {};
    for (const [model, cfg] of Object.entries(models)) {
      if (!cfg || !Array.isArray(cfg.allow)) throw new Error('shape');
      policy[model] = {
        allow: stripDraft(cfg.allow),
        empty: Boolean(cfg.empty), nil: Boolean(cfg.nil), missing: Boolean(cfg.missing),
      };
    }
    return { policy, source: 'env', valid: true };
  } catch {
    return { policy: {}, source: 'env', valid: false };   // invalid config → deny, never fall back
  }
}
const _statusPolicy = resolveStatusPolicy();

/** The effective status policy (for docs/tests/evidence). */
export function statusPolicy() {
  return {
    gatedCollections: [...STATUS_GATED],
    pendingConfirmation: [...STATUS_PENDING_CONFIRMATION],
    source: _statusPolicy.source,
    valid: _statusPolicy.valid,
    perModel: JSON.parse(JSON.stringify(_statusPolicy.policy)),
  };
}

export function isPublicStatus(collection, doc) {
  if (!STATUS_GATED.has(collection)) return true;
  const cfg = _statusPolicy.policy[collection];
  if (!cfg) return false;                       // invalid/absent config → deny (no fallback)
  if (!doc || !Object.prototype.hasOwnProperty.call(doc, 'status') || doc.status === undefined) {
    return Boolean(cfg.missing);
  }
  const raw = doc.status;
  if (raw === null) return Boolean(cfg.nil);
  if (typeof raw !== 'string') return false;    // non-string status → non-public
  const s = raw.trim().toLowerCase();
  if (s === '') return Boolean(cfg.empty);
  return s !== 'draft' && cfg.allow.includes(s);
}

/**
 * EXACT Mongo clause mirroring `isPublicStatus` (so eligibility is decided
 * BEFORE pagination/count/aggregation — no superset-then-trim). Values are
 * matched trim- and case-insensitively; empty / explicit `null` / missing are
 * distinct.
 */
export function statusQueryClause(collection) {
  if (!STATUS_GATED.has(collection)) return null;
  const cfg = _statusPolicy.policy[collection];
  if (!cfg) return { _id: { $exists: false } };   // deny all
  const or = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const v of cfg.allow) or.push({ status: { $regex: `^\\s*${esc(v)}\\s*$`, $options: 'i' } });
  if (cfg.empty) or.push({ status: { $regex: '^\\s*$' } });
  if (cfg.nil) or.push({ status: { $type: 'null' } });
  if (cfg.missing) or.push({ status: { $exists: false } });
  if (!or.length) return { _id: { $exists: false } };   // nothing approved → matches nothing
  return { $or: or };
}

// PAGE display eligibility: a FIXED enum of contexts. The client passes one id
// (`?page=<id>`); the server maps it to a rule. No client-supplied expressions.
export const PAGE_CONTEXTS = Object.freeze({
  artist_page:                  { hide: ['artist_page'] },
  exhibition_page:              { hide: ['exhibition_page'] },
  art_fair_page:                { hide: ['art_fair_page'] },
  artist_rolling_image:         { hide: ['artist_rolling_image'] },
  artist_detail_rolling_image:  { hide: ['artist_detail_rolling_image'] },
  artist_hover_image:           { flag: ['artist_hover_image'] },   // positive selection
});

const REQUIRE_PAGE_CONTEXT = process.env.SHELL_REQUIRE_PAGE_CONTEXT === '1';

/** Resolve `?pageContext=` → { context } | { missing } | { error } (unknown → 400).
 *  NOTE: named `pageContext` (not `page`) because the shell already reserves
 *  `?page=` for pagination. */
export function resolvePageContext(request) {
  let raw = null;
  try { raw = new URL(request.url).searchParams.get('pageContext'); } catch { raw = null; }
  if (raw === null || raw === '') {
    return REQUIRE_PAGE_CONTEXT
      ? { error: true, mustSpecify: true, value: null }
      : { context: null, missing: true, value: null };
  }
  const key = String(raw).trim();
  if (!Object.prototype.hasOwnProperty.call(PAGE_CONTEXTS, key)) return { error: true, value: key };
  return { context: key, missing: false, value: key };
}

/**
 * The hide/flag token set a page context imposes.
 * - known context  → that context's rule (narrows only)
 * - missing context → NO page rule (global eligibility only). This is the
 *   explicit, documented compatibility policy: page hiding is a *display* rule
 *   (a record hidden on `artist_page` is still reachable elsewhere / at its
 *   detail URL), and a strict union would hide records other pages still need
 *   (e.g. images hidden from the rolling slideshow are still image-source data).
 *   `SHELL_REQUIRE_PAGE_CONTEXT=1` turns a missing context into a 400 instead.
 * - unknown context → 400 (handled by resolvePageContext; never "all").
 */
export function pageRule(pageContext) {
  if (pageContext && Object.prototype.hasOwnProperty.call(PAGE_CONTEXTS, pageContext)) {
    const c = PAGE_CONTEXTS[pageContext];
    return { hides: c.hide ? [...c.hide] : [], flags: c.flag ? [...c.flag] : [] };
  }
  return { hides: [], flags: [] };
}

/**
 * Mongo clauses for the GLOBAL + PAGE filters. Pushed into the query so that
 * pagination / count / aggregation already see filtered data (required order:
 * global → page → paginate/count/aggregate → field projection).
 */
export function publicQueryClauses(collection, pageContext) {
  const clauses = [];
  const st = statusQueryClause(collection);
  if (st) clauses.push(st);
  const { hides, flags } = pageRule(pageContext);
  if (hides.length) {
    clauses.push({ 'mark.hide': { $nin: hides } });    // canonical hide list
    clauses.push({ 'mark.marks': { $nin: hides } });   // legacy: HIDE stored under marks
  }
  if (flags.length) clauses.push({ 'mark.marks': { $in: flags } });
  return clauses;
}

export function isPublicRecord(collection, doc) {
  if (!doc || typeof doc !== 'object') return false;
  return isPublicStatus(collection, doc);
}

/** GLOBAL + PAGE eligibility, shape-agnostic (output-stage backstop). */
export function isPublicRecordForPage(collection, doc, pageContext) {
  if (!isPublicRecord(collection, doc)) return false;
  const { hides, flags } = pageRule(pageContext);
  if (hides.length) {
    const h = getMarkHide(doc);
    if (hides.some((t) => h.includes(t))) return false;
  }
  if (flags.length) {
    const f = getMarkFlags(doc);
    if (!flags.some((t) => f.includes(t))) return false;
  }
  return true;
}

function collectionForTemplate(template) {
  if (!template) return null;
  const parts = String(template).split('/').filter(Boolean); // e.g. ['api', 'artwork']
  if (parts[0] !== 'api') return null;
  const seg = parts[1];
  const isBase = parts.length === 2;
  const isById = parts.length === 3 && parts[2] === '[id]';
  if (!isBase && !isById) return null;   // sub-routes (years/reorder/sync) filter server-side
  return Object.prototype.hasOwnProperty.call(PUBLIC_FIELDS, seg) ? seg : null;
}

/** Second path segment (the collection) regardless of the field allowlist. */
function segmentForTemplate(template) {
  if (!template) return null;
  const parts = String(template).split('/').filter(Boolean);
  return parts[0] === 'api' ? parts[1] : null;
}

function projectRecord(doc, fields) {
  const out = {};
  if (doc && typeof doc === 'object' && doc.id !== undefined) out.id = doc.id;
  for (const f of fields) {
    if (doc && Object.prototype.hasOwnProperty.call(doc, f)) out[f] = doc[f];
  }
  return out;
}

/** Filter a public GET response: drop non-public records + internal fields. */
export async function applyPublicFilter(response, template, pageContext = null) {
  const collection = collectionForTemplate(template);
  if (!collection) return response;
  if (!response || response.status !== 200) return response;

  let body;
  try { body = await response.clone().json(); } catch { return response; }
  const fields = PUBLIC_FIELDS[collection];
  const project = (doc) => projectRecord(doc, fields);
  const visible = (doc) => isPublicRecordForPage(collection, doc, pageContext);

  let out;
  if (Array.isArray(body)) {
    out = body.filter(visible).map(project);
  } else if (body && Array.isArray(body.data)) {
    out = { ...body, data: body.data.filter(visible).map(project) };
    if (body.pagination && typeof body.pagination.total === 'number') {
      out.pagination = { ...body.pagination, total: out.data.length };
    }
  } else if (body && typeof body === 'object') {
    if (!visible(body)) return denyNotFound();      // hidden record stays invisible
    out = project(body);
  } else {
    return response;
  }
  return new Response(JSON.stringify(out), { status: 200, headers: NO_STORE });
}

/** Strip internal data from an anonymous CREATE response (2xx only). */
export async function applyPublicCreateFilter(response) {
  if (!response) return response;
  if (response.status < 200 || response.status >= 300) return response;  // never mask an error
  let body = {};
  try { body = await response.clone().json(); } catch { body = {}; }
  const ack = { message: 'Created successfully' };
  if (body && body.id) ack.id = body.id;
  return new Response(JSON.stringify(ack), { status: response.status, headers: NO_STORE });
}

/**
 * True when the caller supplies a valid MANAGER session. Public routes still
 * serve anonymous callers the projected payload; a manager reading through the
 * same route keeps full data. A bad/missing credential just means "not
 * privileged" here (never an error on a public route).
 */
export async function isManagerRequest(request) {
  const hasCred = Boolean(
    (request.headers.get('authorization') || '').trim() ||
    /(?:^|;\s*)authToken=/.test(request.headers.get('cookie') || '')
  );
  if (!hasCred) return false;
  try {
    const auth = await authenticate(request);
    return !auth.error && isManager(auth.user);
  } catch {
    return false;
  }
}

// Replace an anonymous create request's body with only the allowlisted fields.
function filterPublicCreateRequest(request, collection) {
  const allow = PUBLIC_SUBMIT_FIELDS[collection];
  if (!allow) return Promise.resolve(request);
  return request.clone().json().then((body) => {
    const filtered = {};
    if (body && typeof body === 'object') {
      for (const k of allow) if (Object.prototype.hasOwnProperty.call(body, k)) filtered[k] = body[k];
    }
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    return new Request(request.url, { method: request.method, headers, body: JSON.stringify(filtered) });
  }).catch(() => request);
}

/**
 * Wrap a { METHOD: handler } map with enforcement + public-response projection.
 * Handlers are only invoked after authorize() allows; a public GET is projected
 * to the allowlist, an anonymous create is input-filtered and ack-only.
 */
export function guardHandlers(handlers) {
  const out = {};
  for (const method of Object.keys(handlers)) {
    const fn = handlers[method];
    if (typeof fn !== 'function') { out[method] = fn; continue; }
    out[method] = async (request, context) => {
      const auth = await authorize(request);
      if (auth.denied) return auth.denied;

      const upper = String(request.method || method).toUpperCase();
      const collection = collectionForTemplate(auth.template);
      const seg = segmentForTemplate(auth.template);
      const submitCollection = (seg && PUBLIC_SUBMIT_FIELDS[seg]) ? seg : null;

      // Resolve the page context BEFORE the handler runs so the query push-down
      // sees it; an unknown context is refused (never silently "all records").
      let privileged = false;
      let pageContext = null;
      if (auth.policy === PUBLIC && upper === 'GET' && collection) {
        privileged = await isManagerRequest(request);
        if (!privileged) {
          const pc = resolvePageContext(request);
          if (pc.error) return denyBadRequest(`Unknown page context "${pc.value}"`);
          pageContext = pc.context;
          request.__authz = { policy: 'public', manager: false, segment: seg, page: pageContext };
        }
      }

      let effective = request;
      if (auth.policy === PUBLIC && upper === 'POST' && submitCollection) {
        effective = await filterPublicCreateRequest(request, submitCollection);
      }

      const response = await fn(effective, context);

      if (auth.policy === PUBLIC && upper === 'GET' && collection && !privileged) {
        // Anonymous/non-manager: project to the allowlist (mark is never sent).
        return applyPublicFilter(response, auth.template, pageContext);
      }
      if (auth.policy === PUBLIC && upper === 'POST' && submitCollection) {
        return applyPublicCreateFilter(response);
      }
      return response;
    };
  }
  return out;
}
