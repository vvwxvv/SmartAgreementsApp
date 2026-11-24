import { NextResponse } from "next/server";
import { gateStatus } from "@/agreement/adminGate";
import { totpStatus } from "@/agreement/adminTotp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await gateStatus().catch(() => ({ configured: false }));
  // Never return the secret — only whether a second factor is enrolled.
  const totp = await totpStatus().catch(() => ({ configured: false }));
  return NextResponse.json({ ...status, totp: Boolean(totp.configured) }, { headers: { "Cache-Control": "no-store" } });
}
