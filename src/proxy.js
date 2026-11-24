import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { COOKIE, verifyAdminToken } from "@/lib/adminAuth";
import { isPublicPath } from "@/lib/publicRoutes";
import { isForeignOrigin } from "@/lib/csrf";
import { securityHeadersFor } from "@/lib/securityHeaders";

/** Generated per-model CRUD. Reads stay available to the admin UI; every write
 *  is refused so a generic endpoint can never edit a frozen contract or forge
 *  a signature. Business writes go through /api/agreements/* + /api/sign/*. */
const GENERATED_CRUD = [
  "/api/agreement",
  "/api/agreement-signer",
  "/api/signing-event",
  "/api/user",
  "/api/users",
  "/api/session",
  "/api/login-code",
  "/api/upload",
  "/api/form-settings",
];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isGeneratedWrite(pathname, method) {
  if (!WRITE_METHODS.has(method)) return false;
  return GENERATED_CRUD.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function proxy(req) {
  const { pathname, search } = req.nextUrl;
  const method = req.method;
  // One id per request: echoed to the client and used by route-level logs, so a
  // user's "it failed" screenshot can be matched to a log line.
  const rid = req.headers.get("x-request-id") || crypto.randomUUID();
  const secure = (res) => {
    const headers = securityHeadersFor(pathname);
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    res.headers.set("x-request-id", rid);
    // Admin pages must not come back from the back/forward cache after logout.
    if (pathname.startsWith("/manager")) res.headers.set("Cache-Control", "no-store");
    return res;
  };

  // CSRF: a state-changing request carrying a foreign Origin is refused before
  // anything else (same-site forms and fetch send our own host).
  if (WRITE_METHODS.has(method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (isForeignOrigin(origin, host, req.headers.get("sec-fetch-site"))) {
      return NextResponse.json({ error: "cross-origin write refused" }, { status: 403 });
    }
  }

  if (isPublicPath(pathname)) return secure(NextResponse.next());

  const authed = await verifyAdminToken(req.cookies.get(COOKIE)?.value);

  if (isGeneratedWrite(pathname, method)) {
    // Even an authenticated admin cannot write through the generic CRUD.
    return NextResponse.json(
      { error: "该接口已停用：合同与签署数据只能通过业务接口写入。" },
      { status: 405 }
    );
  }

  if (authed) return secure(NextResponse.next());

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return secure(NextResponse.redirect(url));
}

export const config = {
  matcher: ["/((?!_next/|favicon\\.ico|robots\\.txt).*)"],
};
