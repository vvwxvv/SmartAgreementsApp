import { NextResponse } from "next/server";
import { verifyByNumber } from "@/agreement/service";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  // Public endpoint: cap lookups per source so the number space cannot be
  // swept for "which contracts exist" at machine speed.
  const gate = rateLimit({ key: "verify-num:" + clientIp(req), limit: 60, windowMs: 60_000 });
  if (!gate.ok) return tooManyResponse(gate.retryAfter);

  const number = new URL(req.url).searchParams.get("number") || "";
  const status = await verifyByNumber(number);
  if (!status) return NextResponse.json({ error: "未找到该合同编号" }, { status: 404 });
  return NextResponse.json(
    {
      number: status.number,
      status: status.status,
      createdAt: status.createdAt,
      sentAt: status.sentAt,
      completedAt: status.completedAt,
      signedCount: status.signers.filter((s) => s.signed).length,
      total: status.signers.length,
      events: status.events || null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
