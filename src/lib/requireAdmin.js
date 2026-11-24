import { NextResponse } from "next/server";
import { COOKIE, verifyAdminToken } from "@/lib/adminAuth";
import { isForeignOrigin } from "@/lib/csrf";

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** In-route defense in depth: middleware alone is not trusted. */
export async function requireAdmin(request) {
  // Same-gap as auth: middleware can be skipped, so CSRF is checked here too.
  if (WRITE.has(String(request.method || "GET").toUpperCase())) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    const site = request.headers.get("sec-fetch-site");
    if (isForeignOrigin(origin, host, site)) {
      return NextResponse.json({ error: "cross-origin write refused" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }
  const token = request && request.cookies && typeof request.cookies.get === "function"
    ? request.cookies.get(COOKIE)?.value
    : null;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}
