import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { voidAgreement } from "@/agreement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    await voidAgreement(id, body.reason);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || "操作失败" }, { status: 400 });
  }
}
