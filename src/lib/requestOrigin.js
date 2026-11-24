import { headers } from "next/headers";
import { baseUrl } from "@/agreement/instance";

/** Public origin for server components: AGREEMENT_BASE_URL when it is a real
 *  public URL, otherwise the request's forwarded host. Keeps printed hints
 *  correct on Vercel without hard-coding a domain. */
export async function requestOrigin() {
  return baseUrl({ headers: await headers() });
}
