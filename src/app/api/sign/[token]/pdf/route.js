import { NextResponse } from "next/server";
import { getSignerView } from "@/agreement/service";
import { renderAgreementPdf } from "@/agreement/pdf";
import { inc, logEvent, requestIdOf } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The signer's own copy: same PDF, but reached with their link instead of a
 *  session. Only available once at least one signature exists. */
export async function GET(req, { params }) {
  const { token } = await params;
  const view = await getSignerView(token, req.cookies.get("agreement_signer")?.value);
  if (!view) return NextResponse.json({ error: "链接无效或已失效" }, { status: 404 });
  if (!view.signers.some((s) => s.signed)) {
    return NextResponse.json({ error: "还没有人签署" }, { status: 409 });
  }

  try {
    const { buf, filename } = await renderAgreementPdf(req, view.agreement.id, view.agreement.number);
    inc("pdf_ok");
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    inc("pdf_fail");
    logEvent("pdf.error", { rid: requestIdOf(req), scope: "signer", message: e?.message }, "error");
    return NextResponse.json({ error: e.message || "PDF 生成失败" }, { status: 500 });
  }
}
