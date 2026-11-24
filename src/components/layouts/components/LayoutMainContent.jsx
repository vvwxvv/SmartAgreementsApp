"use client";
import { useContext } from "react";
import { usePathname } from "next/navigation";
import { Box } from "@mui/material";
import { ManagerContext } from "@/components/contexts/ManagerContext";
import { DeviceContext } from "@/components/contexts/DeviceContext";
import ManagerSideNav, { BAR_HEIGHT as MANAGER_BAR_HEIGHT } from "@/components/navs/ManagerSideNav";
import TitleTextNavSimpleStyle from "@/components/navs/ManagerNav";
import MainNav from "@/components/navs/MainNav";
import ManagerAuthGate from "@/components/layouts/components/ManagerAuthGate";
import {
  ESTIMATED_FOOTER_HEIGHT,
  MAIN_PT_MOBILE,
  MAIN_PT_DESKTOP,
  BACK_BUTTON_TOP,
  BACK_BUTTON_RIGHT,
} from "@/components/layouts/constants/layout_constants";

/**
 * Core page shell: nav, back button, language switcher, and page content.
 * Uses MainNav for public pages, TitleTextNavSimpleStyle for manager.
 */
export default function LayoutMainContent({ children, showBackButton, isMobile, backgroundColor }) {
  const { isManager } = useContext(ManagerContext);
  const pathname = usePathname() || "";
  // MainNav uses the drawer (and hides the desktop nav row) on mobile + tablet.
  const { isTablet } = useContext(DeviceContext);

  // MainNav includes its own 56px spacer — only add extra pt for manager nav
  const pt = isManager ? `${MANAGER_BAR_HEIGHT}px` : 0;

  const navSlot = isManager ? (
    // Manager chrome = the reference gallery's bar + slide-in drawer.
    <ManagerSideNav />
  ) : (
     <Box sx={{ position: "relative", zIndex: 1100,marginTop:"45px" }} style={{ background: "transparent" }}>
    <MainNav />
  </Box>
  );

  const content = (
    <>
      {navSlot}



      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: "100%",
          overflowY: "auto",
          pb: isManager ? "92px" : ESTIMATED_FOOTER_HEIGHT,
          pt,
          minWidth: 0,
          position: "relative",
        }}
        style={{ backgroundColor, background: backgroundColor }}
      >
        {children}
      </Box>
    </>
  );

  if (isManager) {
    // /manager already sits behind the admin gate (two gestures + optional TOTP).
    // The legacy single-pattern gate only still guards generated manager pages.
    if (pathname === "/manager") return content;
    return <ManagerAuthGate>{content}</ManagerAuthGate>;
  }

  return content;
}
