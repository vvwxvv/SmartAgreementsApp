import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { buildEvidencePackage } from "@/lib/evidencePackage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One ZIP with the printed copy, the per-signer evidence and the raw files.
 * Admin-only: it contains emails, IPs and signature images.
 */
export async function GET(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const { zip, filename } = await buildEvidencePackage({ req, id });
    return new NextResponse(zip, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[agreement:evidence]", e?.message);
    return NextResponse.json({ error: e.message || "导出失败" }, { status: e.status || 500 });
  }
}
