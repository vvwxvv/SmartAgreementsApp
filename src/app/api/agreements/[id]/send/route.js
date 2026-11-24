import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { sendAgreement } from "@/agreement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const out = await sendAgreement(id, req);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: e.message || "发出失败" }, { status: 400 });
  }
}
