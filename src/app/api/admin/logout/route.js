import { NextResponse } from "next/server";
import { COOKIE, adminCookieOptions } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const isHttps = (req?.headers?.get("x-forwarded-proto") || "") === "https";
  // Clear with the same attributes it was set with, otherwise some browsers
  // keep the old cookie and the user stays "logged in".
  res.cookies.set(COOKIE, "", { ...adminCookieOptions(isHttps), maxAge: 0, expires: new Date(0) });
  return res;
}
