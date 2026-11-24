/**
 * 最小但严格的 CSV 读取器（RFC 4180）。
 *
 * 支持：引号包裹、字段内逗号/换行、双引号转义（""）、CRLF、UTF-8 BOM。
 * 不支持：自定义分隔符、注释行——数据文件应当干净、可被 Excel/Numbers 直接打开。
 */

export function parseCsv(text) {
  let src = String(text ?? "");
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => {
    // 尾随空行忽略；中间的空行保留为 []，由调用方决定是否报错。
    if (row.length === 1 && row[0] === "" && rows.length === 0) { row = []; return; }
    rows.push(row); row = [];
  };

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { quoted = true; i += 1; continue; }
    if (ch === ",") { pushField(); i += 1; continue; }
    if (ch === "\r") { i += 1; continue; }
    if (ch === "\n") { pushField(); pushRow(); i += 1; continue; }
    field += ch; i += 1;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  if (field !== "" || row.length) { pushField(); pushRow(); }

  // 去掉末尾空行
  while (rows.length && rows[rows.length - 1].every((v) => v === "")) rows.pop();
  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => h.trim());
  const body = rows.slice(1).map((cells, idx) => {
    if (cells.length !== headers.length) {
      throw new Error(`第 ${idx + 2} 行列数不一致：期望 ${headers.length}，实际 ${cells.length}`);
    }
    const obj = {};
    headers.forEach((h, k) => { obj[h] = cells[k]; });
    return obj;
  });
  return { headers, rows: body };
}

/** 写回 CSV（导入检查/测试用）：总是加引号，避免中文逗号与换行踩坑。 */
export function toCsv(headers, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.map(esc).join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n") + "\n";
}
