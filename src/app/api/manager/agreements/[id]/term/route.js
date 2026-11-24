import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { setTermAgreement } from "@/agreement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function PATCH(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const out = await setTermAgreement(id, { termMonths: body.termMonths, termEnd: body.termEnd, effectiveAt: body.effectiveAt });
    return NextResponse.json(out, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "期限更新失败" }, { status: e.status || 400, headers: NO_STORE });
  }
}
