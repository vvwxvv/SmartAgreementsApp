import SignUI from "../react/sign-page.jsx";

/** Thin server entry: keeps Next-specific props out of the UI component. */
export function SignPage({ token, config }) {
  return <SignUI token={token} apiBase={config.apiBase || "/api/agreement/sign"} />;
}
