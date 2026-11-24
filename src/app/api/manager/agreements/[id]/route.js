import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { getAgreementDetail, patchDraft } from "@/agreement/service";
import { agreementDetail, publicSigner, publicEvent } from "@/lib/managerProjection";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function PATCH(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    await patchDraft(id, body);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "更新失败" }, { status: e.status || 400, headers: NO_STORE });
  }
}

export async function GET(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const detail = await getAgreementDetail(id);
    if (!detail) return NextResponse.json({ error: "未找到" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({
      agreement: agreementDetail(detail.agreement),
      signers: detail.signers.map(publicSigner),
      events: detail.events.map(publicEvent),
    }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "读取失败" }, { status: 500, headers: NO_STORE });
  }
}
