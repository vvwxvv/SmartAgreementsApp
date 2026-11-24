import InvalidLink from "@/components/pages/agreements/InvalidLink";
import PrintDocument from "@/components/pages/agreements/AgreementPrintPageComponent";
import { getPrintableByToken } from "@/agreement/service";
import { requestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

export default async function Page({ params }) {
  const { token } = await params;
  const data = await getPrintableByToken(token).catch((e) => {
    // Do not swallow this silently: a broken print view used to look like a
    // plain 404 with nothing in the logs.
    console.error("[print] getPrintableByToken failed:", e?.message || e);
    return null;
  });
  if (!data) return <InvalidLink reason="签署链接无效或已过期" />;
  return <PrintDocument data={data} backHref={`/sign/${token}`} verifyHint={await requestOrigin()} />;
}
