// src/app/api/auth/pattern/route.js
// ───────────────────────────────────────────────────────────────────────────
// Pattern-lock (connect-the-dots) login. The expected pattern lives in the
// SERVER env (PATTERN_UNLOCK_PASSWORD, e.g. "<pattern>") and is never
// shipped to the browser. On success it mints a short-lived JWT cookie so the
// manager gate (and any per-viewer page) can resolve the caller.
//
//   POST { pattern: [1,2,3,6,9,8,7] }  → 200 { ok, role }  (+ Set-Cookie authToken)
//   GET                                → { authenticated }
//
// Self-contained (no _authUtils import) so it works in every shell variant.
// ───────────────────────────────────────────────────────────────────────────
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

const COOKIE = "authToken";
const noStore = { "Cache-Control": "private, no-store" };

function extractToken(req) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const c = req.headers.get("cookie") || "";
  const cm = c.match(/(?:^|;\s*)authToken=([^;]+)/);
  return cm ? decodeURIComponent(cm[1]) : null;
}

function expectedPattern() {
  return String(process.env.PATTERN_UNLOCK_PASSWORD || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
}

function sessionRole(req) {
  try {
    const t = extractToken(req);
    if (!t) return null;
    const p = jwt.verify(t, process.env.JWT_SECRET);
    return p && p.patternAuth === true ? (p.role || "manager") : null;
  } catch { return null; }
}

export async function GET(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  return NextResponse.json({ authenticated: Boolean(sessionRole(req)) }, { headers: noStore });
}

export async function POST(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  if (!sameOrigin(req)) return NextResponse.json({ error: "cross-origin refused" }, { status: 403, headers: noStore });

  const secret = process.env.JWT_SECRET;
  if (!secret) return NextResponse.json({ error: "auth unavailable" }, { status: 503, headers: noStore });

  const expected = expectedPattern();
  if (!expected.length) return NextResponse.json({ error: "pattern not configured" }, { status: 503, headers: noStore });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400, headers: noStore }); }
  const input = Array.isArray(body?.pattern) ? body.pattern.map(Number) : [];
  const ok = input.length === expected.length && input.every((v, i) => v === expected[i]);

  if (!ok) {
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "incorrect pattern" }, { status: 401, headers: noStore });
  }

  const role = process.env.PATTERN_AUTH_ROLE || "manager";
  const token = jwt.sign({ id: `pattern:${role}`, role, patternAuth: true }, secret, { expiresIn: "30m" });
  const host = req.headers.get("host") || "";
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const secure = (process.env.NODE_ENV === "production" && !loopback) ? "; Secure" : "";
  const res = NextResponse.json({ ok: true, role }, { headers: noStore });
  res.headers.append("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${secure}`);
  return res;
}
