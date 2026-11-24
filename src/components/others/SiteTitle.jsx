"use client";

/**
 * SiteTitle — keeps the document <title> in sync with the app name from the
 * Meta doc (/manager/meta → 应用名称). Renders nothing visible.
 */

import { useEffect } from "react";
import useAppName from "@/hooks/useAppName";

export default function SiteTitle() {
  const { name } = useAppName();
  useEffect(() => {
    if (name) document.title = name;
  }, [name]);
  return null;
}
