import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { extendAgreement } from "@/agreement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function POST(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const out = await extendAgreement(id, body.signDeadline || body.expiresAt);
    return NextResponse.json(out, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "延期失败" }, { status: e.status || 400, headers: NO_STORE });
  }
}
