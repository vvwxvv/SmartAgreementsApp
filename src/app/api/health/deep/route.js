import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { getDb, isLocalMode } from "@/app/api/_lib/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness: proves the data source answers, without leaking counts publicly. */
export async function GET(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  try {
    const db = await getDb();
    const agreements = await db.collection("Agreement").countDocuments({});
    return NextResponse.json(
      { ok: true, dataSource: isLocalMode() ? "local" : "mongo", agreements, ts: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "datastore unavailable", ts: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
