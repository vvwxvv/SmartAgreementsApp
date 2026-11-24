import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { listPartyInfos, createPartyInfo } from "@/agreement/service";
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

export async function GET(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  try {
    const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";
    const rows = await listPartyInfos({ limit: 200, includeArchived });
    return NextResponse.json({ parties: rows.map(publicPartyInfo) }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "读取失败" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const length = Number(req.headers.get("content-length")) || 0;
  if (length > 64 * 1024) return NextResponse.json({ error: "请求体过大" }, { status: 413, headers: NO_STORE });
  try {
    const body = await readJson(req);
    const doc = await createPartyInfo(body);
    return NextResponse.json({ party: publicPartyInfo(doc) }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "创建失败" }, { status: e.status || 400, headers: NO_STORE });
  }
}
