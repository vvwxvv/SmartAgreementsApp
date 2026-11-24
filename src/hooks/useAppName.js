"use client";

/**
 * useAppName — the app's display name, set once in the Meta doc
 * (/manager/meta → Footer → 应用名称 EN / 中文) and reused everywhere:
 * nav, home title, document title, footer.
 *
 * Falls back to FOOTER_DEFAULTS so the name is never blank, then to a generic
 * label as a last resort.
 *
 * @returns {{ en: string, cn: string, name: string }}
 */

import { useContext } from "react";
import { LanguageContext } from "@/components/contexts/LanguageContext";
import useSiteMeta from "@/hooks/useSiteMeta";
import { FOOTER_DEFAULTS } from "@/utils/siteMetaDefaults";

export default function useAppName() {
  const { meta } = useSiteMeta();
  const { isCn } = useContext(LanguageContext);

  const en = meta?.app_footer_en || FOOTER_DEFAULTS.en.companyName || "App";
  const cn = meta?.app_footer_cn || FOOTER_DEFAULTS.cn.companyName || en;

  return { en, cn, name: isCn ? cn : en };
}
