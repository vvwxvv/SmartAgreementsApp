import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { createDraft } from "@/agreement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  try {
    const body = await req.json().catch(() => ({}));
    const id = await createDraft(
      {
        title: body.title,
        category: body.category,
        body: body.body,
        consentText: body.consentText,
        expiresAt: body.expiresAt,
        signers: body.signers,
      },
      process.env.AGREEMENT_ACTOR || "operator"
    );
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: e.message || "创建失败" }, { status: 400 });
  }
}
