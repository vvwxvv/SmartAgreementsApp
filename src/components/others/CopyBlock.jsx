"use client";

import { useState } from "react";

/** 复制一段文本，成功后按钮变勾。 */
export default function CopyBlock({ text, label, copiedLabel = "已复制" }) {
  const [state, setState] = useState("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 1800);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={"aw-iconbtn" + (state === "ok" ? " aw-iconbtn--done" : "")}
      title={state === "ok" ? copiedLabel : label}
      aria-label={state === "ok" ? copiedLabel : label}
    >
      {state === "ok" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="1.5" />
          <path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" />
        </svg>
      )}
    </button>
  );
}
