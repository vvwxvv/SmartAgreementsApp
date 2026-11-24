import InvalidLink from "@/components/pages/agreements/InvalidLink";
import PrintDocument from "@/components/pages/agreements/AgreementPrintPageComponent";
import { checkPrintKey, getPrintableById } from "@/agreement/service";
import { resolveLayoutConfig } from "@/agreement/layoutConfig";
import { requestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

/**
 * Operator/print-server view of a contract.
 * `/p/<id>?k=<hmac>` — the key is minted by /api/agreements/<id>/pdf so the
 * headless Chromium can load the page without a session.
 */
export default async function Page({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const key = sp?.k;
  const preview = sp?.preview === "1" && process.env.NODE_ENV !== "production";

  if (!preview && !checkPrintKey(id, key)) return <InvalidLink reason="打印链接无效或已过期" />;

  const data = await getPrintableById(id).catch(() => null);
  if (!data) return <InvalidLink reason="这份合同暂时无法打印" />;

  // P2-1 preview only: until layoutConfig is stored (P2-2), a layout can be
  // requested for rendering trials. It requires the print key AND an explicit
  // server flag, so production output stays legacy by default.
  let layout = null;
  if (process.env.PRINT_LAYOUT_PREVIEW === "1" && typeof sp?.layout === "string") {
    try { layout = resolveLayoutConfig(sp.layout); } catch { layout = null; }
  }

  return <PrintDocument data={data} showButton={false} verifyHint={await requestOrigin()} layout={layout} />;
}
