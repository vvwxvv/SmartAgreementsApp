import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { getLinks } from "@/agreement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Existing invite links for one agreement (admin-only: the middleware gates
 * /api/* and this route is not in the public list).
 *
 * Invite URLs ARE credentials. They are decrypted server-side, never cached,
 * and never written to logs. `legacy` counts signers whose link predates
 * encrypted storage and therefore cannot be recovered.
 */
export async function GET(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const { links, legacy, failed } = await getLinks(id, req);
    return NextResponse.json(
      { links, legacy, failed },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
    );
  } catch (e) {
    return NextResponse.json({ error: e.message || "无法读取链接" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
