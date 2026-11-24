"use client";

export default function PrintButton() {
  return (
    <button
      className="ag-mono"
      style={{ background: "none", border: 0, borderBottom: "1px solid #111", cursor: "pointer", padding: "2px 0" }}
      onClick={() => window.print()}
    >
      打印 / 另存为 PDF
    </button>
  );
}
