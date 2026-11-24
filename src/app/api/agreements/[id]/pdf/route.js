import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { getAgreementDetail } from "@/agreement/service";
import { renderAgreementPdf } from "@/agreement/pdf";
import { inc, logEvent, requestIdOf } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  const detail = await getAgreementDetail(id).catch(() => null);
  if (!detail) return NextResponse.json({ error: "合同不存在" }, { status: 404 });

  const signed = detail.signers.filter((s) => s.signed).length;
  if (!signed) {
    return NextResponse.json({ error: "还没有人签署，暂时没有可下载的副本" }, { status: 409 });
  }

  try {
    const { buf, filename } = await renderAgreementPdf(req, id, detail.agreement.number);
    inc("pdf_ok");
    // Friendly name for the file the signer actually keeps:
    // 合作约定_AGR-2026-0022_已完成.pdf（ASCII 回退给老浏览器）
    const safeTitle = String(detail.agreement.title || "合同").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
    const state = detail.agreement.completedAt ? "已完成" : "签署中";
    const pretty = `${safeTitle}_${detail.agreement.number}_${state}.pdf`;
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(pretty)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    inc("pdf_fail");
    logEvent("pdf.error", { rid: requestIdOf(req), scope: "admin", message: e?.message }, "error");
    return NextResponse.json({ error: e.message || "PDF 生成失败" }, { status: 500 });
  }
}
