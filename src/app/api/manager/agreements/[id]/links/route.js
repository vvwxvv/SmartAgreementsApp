import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { getLinks } from "@/agreement/service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const { links: rows, legacy, failed } = await getLinks(id, req);
    return NextResponse.json({ links: rows, legacy, failed }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "无法读取链接" }, { status: 400, headers: NO_STORE });
  }
}
