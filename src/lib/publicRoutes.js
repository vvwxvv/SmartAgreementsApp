/**
 * Public route whitelist (P2-1 Phase 1).
 *
 * Default deny: everything not matched here requires the admin cookie.
 * Matching is anchored; encoded separators/dot segments are rejected.
 */

const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ASSET = /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|css|js|mjs|json|txt|map)$/i;

export function normalizePathname(pathname) {
  const raw = String(pathname || '/');
  // Encoded separators or dots are never used by a public route; refuse them.
  if (/%2f|%5c|%2e/i.test(raw)) return null;
  const parts = [];
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return '/' + parts.join('/');
}

export function isPublicPath(pathname) {
  const p = normalizePathname(pathname);
  if (!p || p === '/') return false;

  if (p === '/robots.txt' || p === '/favicon.ico') return true;
  if (p === '/admin/login') return true;
  // Retired single-pattern login: the page itself redirects to /admin/login.
  // Public so the proxy does not append ?next=/login and bounce the user twice.
  if (p === '/login') return true;
  if (p === '/verify') return true;
  // 公开的「协议导出规范」：给 AI 模型直接抓取，不需要登录
  if (p === '/ai-spec' || p === '/ai-spec/raw') return true;
  if (p === '/api/health') return true;
  if (p === '/api/verify' || p === '/api/verify/signature') return true;
  // Public presentation subset (footer/title). PUT on the same path still
  // requires an admin session inside the route handler.
  if (p === '/api/meta') return true;
  if (p === '/api/admin/gate' || p === '/api/admin/gate/unlock' || p === '/api/admin/logout') return true;

  if (p.startsWith('/_next/static/') || p.startsWith('/_next/image') || p.startsWith('/fonts/')) return true;
  if (ASSET.test(p)) return true;

  const sign = /^\/sign\/([^/]+)(?:\/print)?$/.exec(p);
  if (sign && TOKEN.test(sign[1])) return true;

  const apiSign = /^\/api\/sign\/([^/]+)(?:\/(?:submit|pdf|decline)|\/attachments\/[a-f0-9]{24})?$/.exec(p);
  if (apiSign && TOKEN.test(apiSign[1])) return true;

  const print = /^\/print\/([^/]+)$/.exec(p);
  if (print && OBJECT_ID.test(print[1])) return true;

  const integration = /^\/api\/integration\/agreements\/([^/]+)\/status$/.exec(p);
  if (integration && OBJECT_ID.test(integration[1])) return true;

  return false;
}
