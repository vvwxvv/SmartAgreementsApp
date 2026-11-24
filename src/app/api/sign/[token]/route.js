import { NextResponse } from "next/server";
import { getSignerView } from "@/agreement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { token } = await params;
  const view = await getSignerView(token, req.cookies.get("agreement_signer")?.value);
  if (!view) return NextResponse.json({ error: "链接无效或已失效" }, { status: 404 });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}
