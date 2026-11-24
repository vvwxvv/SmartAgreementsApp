import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { rotateLink } from "@/agreement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id, sid } = await params;
  try {
    const out = await rotateLink(id, sid, req);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: e.message || "生成失败" }, { status: e.status || 400 });
  }
}
