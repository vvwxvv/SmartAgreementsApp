/** Response headers for pages whose URL carries a signing/print token. */
export const TOKEN_PAGE_HEADERS = Object.freeze({
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
});

export const SIGN_PAGE_HEADERS = Object.freeze({
  ...TOKEN_PAGE_HEADERS,
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
});

/** Baseline for every other page/API: cheap, non-breaking hardening. */
export const BASE_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
});

export function securityHeadersFor(pathname) {
  const p = String(pathname || "");
  if (p.startsWith("/sign/")) return SIGN_PAGE_HEADERS;
  if (p.startsWith("/print/")) return TOKEN_PAGE_HEADERS;
  return BASE_HEADERS;
}
