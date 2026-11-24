/**
 * Root layout — a Server Component on purpose.
 *
 * The theme script has to reach the browser before first paint, and React 19
 * (Next 16) warns whenever a *client* component renders a <script> tag. Keeping
 * <html>/<head>/<body> on the server and pushing all router/provider/state
 * logic into <AppShell> keeps that script out of React's client tree.
 */
import "../app/globals.css";
import "../app/agreement-ui.css";
import "../app/agreement-v2.css";
import "../app/print-layouts.css";
import AppShell from "@/components/layouts/AppShell";
import Meta from "@/components/meta/meta";

// Runs before first paint: read the stored theme and put it on <html>.
const THEME_INIT = `try{var t=localStorage.getItem("theme")||"light";var d=document.documentElement;d.classList.toggle("dark",t==="dark");d.setAttribute("data-theme",t==="dark"?"dark":"light");d.style.setProperty("--background-primary",t==="dark"?"#000000":"#ffffff");d.style.setProperty("--text-primary",t==="dark"?"#ffffff":"#000000");}catch(e){}`;

export const metadata = {
  title: "Agreement",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Plain inline script: it must run while the head is parsed, before
            the first paint. (next/script injects later, from a chunk.) */}
        <script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <Meta />
      </head>
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
