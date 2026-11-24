import SignPage from "@/components/pages/agreements/AgreementSignPageComponent";

export const dynamic = "force-dynamic";

export default async function Page({ params }) {
  const { token } = await params;
  return <SignPage token={token} />;
}
