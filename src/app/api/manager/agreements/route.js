import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { listAgreements, createDraft, sendAgreement, getStatus } from "@/agreement/service";
import { agreementSummary } from "@/lib/managerProjection";
import { readJsonLimited, LIMITS } from "@/lib/httpBody";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function POST(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  try {
    const body = await readJsonLimited(req, LIMITS.draftBytes);
    if (!body.partyA || !body.partyB) {
      return NextResponse.json({ error: "partyA 和 partyB 必填" }, { status: 400, headers: NO_STORE });
    }
    const id = await createDraft({
      title: body.title, body: body.body, consentText: body.consentText,
      expiresAt: body.expiresAt, signDeadline: body.signDeadline, termMonths: body.termMonths,
      termEnd: body.termEnd, effectiveAt: body.effectiveAt,
      // Explicit signer lists (a third party, or a different signing address)
      // used to be dropped here, so only the two contact emails could sign.
      signers: Array.isArray(body.signers) ? body.signers : [],
      partyA: body.partyA, partyB: body.partyB,
    }, "manager");
    const status = await getStatus(id);
    if (body.send) {
      const sent = await sendAgreement(id, req);
      return NextResponse.json({ id, number: status.number, links: sent.links }, { status: 201, headers: NO_STORE });
    }
    return NextResponse.json({ id, number: status.number }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "创建失败" }, { status: e.status || 400, headers: NO_STORE });
  }
}

export async function GET(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit")) || 50;
    const cursor = url.searchParams.get("cursor") || undefined;
    const rows = await listAgreements({ limit, cursor });
    const nextCursor = rows.length ? rows[rows.length - 1].createdAt : null;
    return NextResponse.json({ agreements: rows.map(agreementSummary), nextCursor }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "读取失败" }, { status: 500, headers: NO_STORE });
  }
}
