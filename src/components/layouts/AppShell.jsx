"use client";

/**
 * Everything under <body> that needs the router, providers or browser APIs.
 *
 * It lives in its own client component so the root layout can stay a Server
 * Component — that is what keeps the theme script out of React's client tree
 * (React 19 warns about <script> rendered by a client component).
 */
import "@/utils/antdReact19Compat";
import { usePathname } from "next/navigation";
import { ThemeProviderLite } from "@/components/contexts/ThemeProviderLite";
import { LanguageProvider } from "@/components/contexts/LanguageContext";
import { DeviceProvider } from "@/components/contexts/DeviceContext";
import { ManagerProvider } from "@/components/contexts/ManagerContext";
import HydrationSafeWrapper from "@/components/others/HydrationSafeWrapper";
import LayoutContent from "@/components/layouts/components/LayoutContent";
import SiteTitle from "@/components/others/SiteTitle";
import SiteFooter from "@/components/footers/SiteFooter";

export default function AppShell({ children }) {
  const pathname = usePathname() || "";

  // Signing / printing / admin surfaces are standalone documents: no site
  // chrome, no manager bar. Everything else keeps the generated shell.
  const bare =
    pathname === "/" ||
    pathname === "/verify" ||
    pathname === "/manager" ||
    pathname.startsWith("/sign/") ||
    pathname === "/ai-spec" ||
    pathname.startsWith("/ai-spec/") ||
    pathname.startsWith("/print/") ||
    pathname.startsWith("/admin");

  if (bare) {
    // Legal documents (sign / print / admin) stay chrome-free. The public
    // verify and manager pages get a quiet copyright footer with the theme
    // switch inside it. Printing and the admin gate stay chrome-free (a PDF
    // must never inherit dark mode).
    // 打印页（/print/<id> 与 /sign/<token>/print）不渲染站点页脚和浮动控件
    const isPrintish = pathname.startsWith("/print/") || pathname.startsWith("/sign/");
    const withFooter = !isPrintish && !pathname.startsWith("/admin") && pathname !== "/ai-spec";
    if (!withFooter) return children;

    return (
      <ThemeProviderLite defaultTheme="light" storageKey="theme">
        {children}
        <SiteFooter narrow={pathname === "/verify"} />
      </ThemeProviderLite>
    );
  }

  return (
    <LanguageProvider>
      <ThemeProviderLite defaultTheme="light" storageKey="theme">
        <SiteTitle />
        <ManagerProvider>
          <DeviceProvider>
            <HydrationSafeWrapper>
              <LayoutContent>{children}</LayoutContent>
            </HydrationSafeWrapper>
          </DeviceProvider>
        </ManagerProvider>
      </ThemeProviderLite>
    </LanguageProvider>
  );
}
