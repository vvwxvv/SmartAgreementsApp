import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PrintButton from "./print-button.jsx";

const host = (u) => (u ? String(u).replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "");

// One timezone for the whole document. The server may run anywhere; the
// reader should never have to reconcile "11:37" with "03:37 GMT" on one page.
const fmt = (d) =>
  d
    ? new Date(d).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      })
    : "—";

/** Loopback addresses are a local-test artifact, not something to print. */
const ipLabel = (ip) => (!ip ? "—" : /^(::1|127\.0\.0\.1)$/.test(String(ip)) ? "本机" : ip);

/** TSA responses come back as RFC-822 GMT strings; show them in the same
 *  timezone as every other timestamp in the document. */
const fmtTsa = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : fmt(d);
};

export default function PrintDocument({ data, backHref, showButton = true, verifyHint = "" }) {
  const a = data.agreement;
  // A localhost URL printed into a PDF is a dead link for whoever receives it.
  const publicHint = /localhost|127\.0\.0\.1|\[::1\]/i.test(verifyHint) ? "" : verifyHint;
  const verifyLine = publicHint
    ? `${publicHint}/verify 输入合同编号 ${a.number}`
    : `在部署地址的 /verify 页输入合同编号 ${a.number}`;
  return (
    <div className="ag-print" style={{ background: "#fff", minHeight: "100vh" }}>
      {showButton ? (
        <div className="ag-no-print" style={{ padding: "16px 24px", borderBottom: "1px solid #e3e3e3", display: "flex", justifyContent: "space-between" }}>
          {backHref ? <a href={backHref} className="ag-mono" style={{ color: "#111" }}>← 返回</a> : <span />}
          <PrintButton />
        </div>
      ) : null}

      <style
        dangerouslySetInnerHTML={{
          __html: `@page {
  @bottom-left { content: "${String(a.number).replace(/"/g, "")}"; font-family: ui-monospace, Menlo, monospace; font-size: 7.5pt; color: #777; }
  @bottom-right { content: "第 " counter(page) " / " counter(pages) " 页"; font-family: ui-monospace, Menlo, monospace; font-size: 7.5pt; color: #777; }
}`,
        }}
      />
      <div className="ag-print-page">
        <div className="ag-mono" style={{ marginBottom: 10 }}>{a.number}</div>
        <h1 className="ag-print-title">{a.title}</h1>
        <div className="ag-mono" style={{ marginBottom: 24, color: "#555" }}>
          发出 {fmt(a.sentAt)} · {a.completedAt ? `完成 ${fmt(a.completedAt)}` : "签署进行中"}
          {!a.completedAt ? ` · ${data.signers.filter((x) => x.signed).length}/${data.signers.length}` : ""}
          <span style={{ marginLeft: 8 }}>（时间均为 UTC+8）</span>
        </div>

        <div className="ag-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.body}</ReactMarkdown>
        </div>

        <div className="ag-sign-block">
          <div className="ag-mono">{a.completedAt ? "签署" : "签署（进行中）"}</div>
          <p style={{ margin: "10px 0 0", fontSize: "9.5pt", lineHeight: 1.7, color: "#333" }}>{a.consentText}</p>
          <div className="ag-sign-grid">
            {data.signers.map((s, i) => (
              <div className="ag-sign-cell" key={i}>
                <div style={{ fontSize: 11, marginBottom: 4 }}>{s.label || `签署人 ${i + 1}`}</div>
                {s.image ? (
                  <img src={s.image} alt={`${s.signedName || s.label || "signer"} signature`} />
                ) : (
                  <div style={{ height: 58, display: "flex", alignItems: "flex-end", fontSize: 10, color: "#9a9a9a" }}>未签署</div>
                )}
                {s.signedName && s.signedName !== s.label ? (
                  <div style={{ fontSize: 11, marginTop: 6 }}>{s.signedName}</div>
                ) : null}
                <div className="ag-finger" style={{ marginTop: 2 }}>{fmt(s.signedAt)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="ag-appendix">
          <div className="ag-mono">Appendix</div>
          <h2 style={{ fontSize: "14pt", margin: "8px 0 4px", fontWeight: 600 }}>签署记录</h2>
          <div style={{ fontSize: "9pt", color: "#555", lineHeight: 1.8, marginBottom: 12 }}>
            这一节是技术记录，不属于合同条款。记录编号是下方摘要的前 16 位，用来核对同一条记录是否被改动；
            它只是自查编号，不证明签署人身份。时间戳由第三方签发，只证明这条记录在该时刻已经存在。
          </div>

          <table className="ag-cert-table">
            <thead>
              <tr>
                <th>签署人</th>
                <th>签署时间</th>
                <th>签署 IP</th>
                <th>记录编号</th>
              </tr>
            </thead>
            <tbody>
              {data.signers.map((s, i) => (
                <tr key={i}>
                  <td>{s.label || `签署人 ${i + 1}`}</td>
                  <td>{fmt(s.signedAt)}</td>
                  <td>{ipLabel(s.signedIp)}</td>
                  <td className="ag-finger">{s.signatureHash ? s.signatureHash.slice(0, 16).toUpperCase() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 18, fontSize: "8.5pt", color: "#444", lineHeight: 1.9 }}>
            <div>合同编号　{a.number}</div>
            <div className="ag-finger" style={{ wordBreak: "break-all" }}>内容指纹　{a.contentHash || "—"}</div>
            {data.signers.map((s, i) =>
              s.signatureHash ? (
                <div key={i} className="ag-finger" style={{ wordBreak: "break-all" }}>
                  {s.label || `签署人 ${i + 1}`} 签名指纹　{s.signatureHash}
                </div>
              ) : null
            )}
            {data.signers
              .filter((s) => s.tsaTime)
              .map((s, i) => (
                <div key={`t${i}`} className="ag-finger">
                  {s.label || `签署人 ${i + 1}`} 第三方时间戳　{fmtTsa(s.tsaTime)}（UTC+8，{host(s.tsaUrl)}）
                </div>
              ))}
            <div>查验方式　{verifyLine}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
