import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { getPartyInfo, updatePartyInfo, archivePartyInfo } from "@/agreement/service";
import { publicPartyInfo } from "@/lib/managerProjection";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const MAX_BODY = 64 * 1024;

async function readJson(req) {
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY) {
    const e = new Error("请求体过大"); e.status = 413; throw e;
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { const e = new Error("JSON 无效"); e.status = 400; throw e; }
}

export async function GET(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  const doc = await getPartyInfo(id).catch(() => null);
  if (!doc) return NextResponse.json({ error: "未找到" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ party: publicPartyInfo(doc) }, { headers: NO_STORE });
}

export async function PATCH(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const body = await readJson(req);
    await updatePartyInfo(id, body);
    const doc = await getPartyInfo(id);
    if (!doc) return NextResponse.json({ error: "未找到" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ party: publicPartyInfo(doc) }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "更新失败" }, { status: e.status || 400, headers: NO_STORE });
  }
}

export async function DELETE(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const { applied } = await archivePartyInfo(id);
    if (!applied) return NextResponse.json({ error: "未找到" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "归档失败" }, { status: 400, headers: NO_STORE });
  }
}
