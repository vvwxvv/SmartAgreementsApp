import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness only: no database access, no build details. Cheap for uptime probes. */
export async function GET() {
  return NextResponse.json(
    { ok: true, uptime: Math.round(process.uptime()), ts: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
