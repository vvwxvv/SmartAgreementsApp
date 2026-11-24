import { notFound } from "next/navigation";
import PrintDocument from "../react/print-document.jsx";
import { runtimeFor } from "./runtime.js";

const hint = (config) => (typeof config.baseUrl === "string" ? config.baseUrl : "");

export async function SignPrintPage({ token, config }) {
  const { service } = runtimeFor(config);
  const data = await service.getPrintableByToken(token).catch(() => null);
  if (!data) notFound();
  return <PrintDocument data={data} backHref={`/sign/${token}`} verifyHint={hint(config)} />;
}

export async function PrintPage({ id, printKey, config }) {
  const { service } = runtimeFor(config);
  if (!service.checkPrintKey(id, printKey)) notFound();
  const data = await service.getPrintableById(id).catch(() => null);
  if (!data) notFound();
  return <PrintDocument data={data} showButton={false} verifyHint={hint(config)} />;
}
