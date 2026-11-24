import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { metricsSnapshot } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** In-process counters since boot (sign/PDF/TSA/rate-limit). Admin only. */
export async function GET(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  return NextResponse.json(metricsSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
