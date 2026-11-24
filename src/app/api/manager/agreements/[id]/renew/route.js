import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { renewAgreement } from "@/agreement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function POST(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const out = await renewAgreement(id);
    return NextResponse.json(out, { status: 201, headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "续签失败" }, { status: e.status || 400, headers: NO_STORE });
  }
}
