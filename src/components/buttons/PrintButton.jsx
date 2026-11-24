"use client";

/**
 * 打印按钮：打印机图标 + 「打印」。
 * 之前是纯文字「打印 / 另存为 PDF」，和旁边的「下载 PDF」挤在一起，看不出是两个动作。
 */
export default function PrintButton() {
  return (
    <button type="button" className="ag-tool-btn" onClick={() => window.print()}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9V3h12v6" />
        <rect x="3" y="9" width="18" height="8" rx="1.5" />
        <path d="M6 17h12v4H6z" />
        <path d="M17.5 12.5h.01" />
      </svg>
      <span>打印</span>
    </button>
  );
}
