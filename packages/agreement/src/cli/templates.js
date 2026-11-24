// Generated files intentionally stay thin: all behaviour lives in the package.
// They import the host config explicitly, because a re-export cannot pass config.

export const CONFIG_FILE = `import { defineAgreement } from "@yourorg/agreement/next";

// Fill these in. The module refuses to run with missing secrets or storage.
export const agreementConfig = defineAgreement({
  storage: async () => {
    throw new Error("configure storage: see @yourorg/agreement/core/adapters/mongo");
  },
  baseUrl: process.env.AGREEMENT_BASE_URL,
  secrets: {
    linkKey: process.env.AGREEMENT_LINK_KEY,
    signSecret: process.env.JWT_SECRET,
  },
  auth: {
    // Return { id } for an authenticated operator, or null.
    getAdmin: async () => null,
  },
  tenancy: "single",
});
`;

export const SIGN_PAGE = `import { SignPage } from "@yourorg/agreement/next/sign-page";
import { agreementConfig } from "@/lib/agreement";

export const dynamic = "force-dynamic";

export default async function Page({ params }) {
  const { token } = await params;
  return <SignPage token={token} config={agreementConfig} />;
}
`;

export const SIGN_PRINT_PAGE = `import { SignPrintPage } from "@yourorg/agreement/next/print-page";
import { agreementConfig } from "@/lib/agreement";

export const dynamic = "force-dynamic";

export default async function Page({ params }) {
  const { token } = await params;
  return <SignPrintPage token={token} config={agreementConfig} />;
}
`;

export const PRINT_PAGE = `import { PrintPage } from "@yourorg/agreement/next/print-page";
import { agreementConfig } from "@/lib/agreement";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }) {
  const { id } = await params;
  const { k } = await searchParams;
  return <PrintPage id={id} printKey={k} config={agreementConfig} />;
}
`;

export const API_ROUTE = `import { createHandlers } from "@yourorg/agreement/next/api";
import { agreementConfig } from "@/lib/agreement";

export const { GET, POST, PATCH, DELETE } = createHandlers(agreementConfig);
`;
