import { NextResponse } from "next/server";
import { getStatus } from "@/agreement/service";
import { isIntegrationAuthorized, MIN_INTEGRATION_SECRET_LENGTH } from "@/lib/integrationAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-to-server status lookup for other apps.
 *   GET /api/integration/agreements/<id>/status
 *   Authorization: Bearer <AGREEMENT_INTEGRATION_SECRET>
 *
 * Returns only what a caller needs to grant access: status + which emails signed.
 * Never returns the body, signature images or the full signer profile.
 */
export async function GET(req, { params }) {
  const secret = process.env.AGREEMENT_INTEGRATION_SECRET;
  if (!secret) return NextResponse.json({ error: "integration disabled" }, { status: 503 });
  if (secret.length < MIN_INTEGRATION_SECRET_LENGTH) {
    return NextResponse.json({ error: "integration secret too short" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") || "";
  if (!isIntegrationAuthorized(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const status = await getStatus(id);
  if (!status) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
