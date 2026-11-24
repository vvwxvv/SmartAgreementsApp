"use client";

import { useEffect, useRef } from "react";

/**
 * 模态框的无障碍行为：
 *   - Esc 关闭
 *   - Tab / Shift+Tab 在框内循环（焦点不跑到背景页）
 *   - 打开时锁 body 滚动，关闭后把焦点还给触发按钮
 *
 * 用法：
 *   const ref = useModalA11y(open, () => setOpen(false));
 *   <div className="panel" ref={ref} role="dialog" aria-modal="true">…</div>
 */
export function useModalA11y(open, onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const el = ref.current;
    const previous = typeof document !== "undefined" ? document.activeElement : null;
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const items = () => (el ? Array.from(el.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null) : []);

    const timer = setTimeout(() => {
      const list = items();
      // On a real pointer device, start at the first field (typing is the likely
      // next action). On touch, do not — an auto-focused input pops the keyboard.
      const fine = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
      const field = fine ? list.find((n) => /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) : null;
      const first = field || list[0];
      if (first) first.focus({ preventScroll: true });
      else el?.focus?.({ preventScroll: true });
    }, 30);

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (previous && typeof previous.focus === "function") previous.focus({ preventScroll: true });
    };
  }, [open]);

  return ref;
}

export default useModalA11y;
