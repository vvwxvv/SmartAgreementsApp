"use client";

/**
 * SiteFooter — quiet copyright line + theme icon for standalone pages
 * (/verify, /manager). Values come from the Prisma `Meta` document:
 *   app_footer_cn / app_footer_en          company or product name
 *   app_footer_start_year                  first year of the range
 *   app_footer_rights_cn / _en             rights sentence
 *
 * The public /api/meta endpoint projects just these presentation fields, so a
 * visitor can see the configured copyright without an admin session.
 */
import useSiteMeta from "@/hooks/useSiteMeta";
import { FOOTER_DEFAULTS } from "@/utils/siteMetaDefaults";
import ThemeIconButton from "@/components/others/ThemeIconButton";

export default function SiteFooter({ lang = "cn", narrow = false }) {
  const { meta } = useSiteMeta();
  const cn = lang !== "en";
  const startYear = Number(meta?.app_footer_start_year) || FOOTER_DEFAULTS.cn.startYear;
  const currentYear = new Date().getFullYear();
  const years = startYear < currentYear ? `${startYear}–${currentYear}` : `${currentYear}`;
  const name =
    (cn ? meta?.app_footer_cn : meta?.app_footer_en) ||
    (cn ? FOOTER_DEFAULTS.cn.companyName : FOOTER_DEFAULTS.en.companyName);
  const rights =
    (cn ? meta?.app_footer_rights_cn : meta?.app_footer_rights_en) ||
    (cn ? FOOTER_DEFAULTS.cn.rightsText : FOOTER_DEFAULTS.en.rightsText);

  return (
    <footer className={"site-foot" + (narrow ? " site-foot--narrow" : "")}>
      <div className="site-foot-inner">
        <span className="site-foot-copy">
          © {years} {name}
          {rights ? ` · ${rights}` : ""}
        </span>
        <ThemeIconButton />
      </div>
    </footer>
  );
}
