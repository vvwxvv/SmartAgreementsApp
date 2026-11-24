import React, { useContext } from "react";
import { motion } from 'framer-motion';
import { LanguageContext } from "../contexts/LanguageContext";
import useFont from '@/hooks/useFont';
import useBackgroundColor from "@/hooks/useBackgroundColor";
import { useReverseTheme } from '@/hooks/useReverseTheme';
import { DeviceContext } from "@/components/contexts/DeviceContext";
import { ManagerContext } from "@/components/contexts/ManagerContext";
import useSiteMeta from "@/hooks/useSiteMeta";
import { FOOTER_DEFAULTS } from "@/utils/siteMetaDefaults";

const Footer = () => {
  const { isCn, isLoading } = useContext(LanguageContext);
  const { isMobile } = useContext(DeviceContext);
  const { contentFontFamily } = useFont();
  const { colors } = useReverseTheme();
  const { isManager } = useContext(ManagerContext);

  const { getBackgroundStyle } = useBackgroundColor('transparent', {
    useCustomColor: true
  });

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.4,
        ease: "easeOut"
      }
    }
  };

  // Everything comes from the Meta doc (defaults live in siteMetaDefaults).
  // Fall back to FOOTER_DEFAULTS so the app name never goes blank when the
  // stored Meta value is empty/stale.
  const { meta } = useSiteMeta();
  const startYear = meta?.app_footer_start_year || FOOTER_DEFAULTS.en.startYear;
  const companyName =
    (isCn ? meta?.app_footer_cn : meta?.app_footer_en) ||
    (isCn ? FOOTER_DEFAULTS.cn.companyName : FOOTER_DEFAULTS.en.companyName);
  const rightsText =
    (isCn ? meta?.app_footer_rights_cn : meta?.app_footer_rights_en) ||
    (isCn ? FOOTER_DEFAULTS.cn.rightsText : FOOTER_DEFAULTS.en.rightsText);
  const currentYear = new Date().getFullYear();

  // 构造版权文本
  const yearRange = startYear === currentYear
    ? `${currentYear}`
    : `${startYear}–${currentYear}`;
  const copyright = isLoading
    ? `© ${currentYear} ${isCn ? '' : ''}. ${rightsText}.`   // 加载中占位（保留原逻辑）
    : `© ${yearRange} ${companyName}. ${rightsText}.`;

  // Manager mode is a full-screen workspace (and the lock screen owns the whole
  // viewport) — the fixed footer would sit on top of it.
  if (isManager) return null;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="fixed bottom-0 left-0 w-full z-50"
      style={{
        backgroundColor: colors.background,
      }}
    >
      <div 
        className="flex items-center justify-center px-2 py-1"
        style={{ backgroundColor: colors.background }}
      >
        <div 
          className="text-xs tracking-wider uppercase"
          style={{
            color: colors.text,
            fontFamily: contentFontFamily,
            fontSize: '11px',
            boxShadow: '0 -2px 10px rgba(219, 219, 219, 0.1)',
            backgroundColor: colors.background
          }}
        >
          {copyright}
        </div>
      </div>
    </motion.div>
  );
};

export default Footer;