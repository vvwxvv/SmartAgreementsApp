import MarkdownBody from "@/components/others/MarkdownBody";
import { localized } from "@/lib/agreementLocale";
import PrintButton from "@/components/buttons/PrintButton";
import { layoutToCssVars } from "@/agreement/layoutConfig";
import { numberHeadings, extractHeadings } from "@/lib/contractSections";
import { stripDuplicateTitle } from "@/agreement/markdown";

// 目录：只在文档确实分成多章时出现，5 章以上才值得占一屏。
const TOC_MIN_SECTIONS = 5;

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
const fmtSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const ipLabel = (ip) => (!ip ? "—" : /^(::1|127\.0\.0\.1)$/.test(String(ip)) ? "本机" : ip);

/** TSA responses come back as RFC-822 GMT strings; show them in the same
 *  timezone as every other timestamp in the document. */
const fmtTsa = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : fmt(d);
};

export default function PrintDocument({ data, backHref, showButton = true, verifyHint = "", layout = null }) {
  const a = data.agreement;
  const cssVars = layout ? layoutToCssVars(layout) : undefined;
  // A localhost URL printed into a PDF is a dead link for whoever receives it.
  const publicHint = /localhost|127\.0\.0\.1|\[::1\]/i.test(verifyHint) ? "" : verifyHint;
  const verifyLine = publicHint
    ? `${publicHint}/verify 输入合同编号 ${a.number}`
    : `在部署地址的 /verify 页输入合同编号 ${a.number}`;
  const bodyMd = localized(a, "body");
  const headings = extractHeadings(numberHeadings(stripDuplicateTitle(bodyMd, localized(a, "title"))));
  const chapterCount = headings.filter((h) => h.level === 2).length;
  const showToc = chapterCount >= TOC_MIN_SECTIONS;
  return (
    <div className={"ag-print ag-print-screen" + (layout ? " pd pd--" + layout.preset : "")} style={cssVars}>
      {showButton ? (
        <div className="ag-no-print ag-print-bar">
          {backHref ? <a href={backHref} className="ag-mono" style={{ color: "#111" }}>← 返回</a> : <span />}
          <div className="ag-print-actions">
            <PrintButton />
            <a className="ag-tool-btn" href={`/api/agreements/${a.id}/pdf`} download>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="M8 11l4 4 4-4" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              <span>导出 PDF</span>
            </a>
          </div>
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
      <div className="ag-sheet">
      {layout && layout.cover ? (
        <section className="pd-cover">
          <div className="pd-cover-kicker">Agreement · {a.number}</div>
          <h1 className="pd-cover-title">{localized(a, "title")}</h1>
          <div className="pd-cover-rule" />
          <div className="pd-cover-meta">
            发出 {fmt(a.sentAt)} · {a.completedAt ? `完成 ${fmt(a.completedAt)}` : "签署进行中"}
            <br />共 {data.signers.length} 位签署人
          </div>
          <div className="pd-cover-parties">
            {data.signers.map((s, i) => (
              <div key={i}>{s.label || `签署人 ${i + 1}`}{s.signed ? " · 已签署" : ""}</div>
            ))}
          </div>
        </section>
      ) : null}
      <div className="ag-print-page">
        {layout && layout.headerRule ? <div className="pd-header-rule">{layout.headerRule}</div> : null}
        <div className="ag-mono" style={{ marginBottom: 10 }}>{a.number}</div>
        <h1
          className="ag-print-title"
          style={
            // A 200-character title at 21pt wraps one or two glyphs per line and
            // prints as vertical stripes. Step the size down instead.
            String(localized(a, "title") || "").length > 60
              ? { fontSize: "14pt", lineHeight: 1.5, letterSpacing: "0", wordBreak: "break-word" }
              : String(localized(a, "title") || "").length > 30
                ? { fontSize: "17pt", lineHeight: 1.45, wordBreak: "break-word" }
                : undefined
          }
        >
          {localized(a, "title")}
        </h1>
        <div className="ag-mono ag-print-meta" style={{ marginBottom: 24, color: "#555" }}>
          发出 {fmt(a.sentAt)} · {a.completedAt ? `完成 ${fmt(a.completedAt)}` : "签署进行中"}
          {!a.completedAt ? ` · ${data.signers.filter((x) => x.signed).length}/${data.signers.length}` : ""}
          <span style={{ marginLeft: 8 }}>（时间均为 UTC+8）</span>
        </div>

        {showToc ? (
          <nav className={"ag-toc" + (chapterCount >= 8 || headings.length > 12 ? " ag-toc--break" : "")} aria-label="目录">
            <div className="ag-mono ag-toc-title">目录 / CONTENTS</div>
            <ol className="ag-toc-list">
              {headings.map((h, i) => {
                const m = /^([一二三四五六七八九十]+、|第[一二三四五六七八九十百零〇\d]+条)\s*(.+)$/.exec(h.text);
                return (
                  <li key={i} className={"ag-toc-item ag-toc-l" + h.level}>
                    <a href={"#" + h.id}>
                      {m ? (
                        <>
                          <span className="ag-toc-no">{m[1]}</span>
                          <span className="ag-toc-text">{m[2]}</span>
                        </>
                      ) : (
                        <span className="ag-toc-text">{h.text}</span>
                      )}
                      <span className="ag-toc-dots" aria-hidden="true" />
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}

        <div className="ag-prose ag-contract">
          <MarkdownBody markdown={bodyMd} title={localized(a, "title")} />
        </div>

        {data.attachments?.length ? (
          <div style={{ marginTop: 18, borderTop: "1px solid #ddd", paddingTop: 12 }}>
            <div className="ag-mono" style={{ marginBottom: 8 }}>附件 / ATTACHMENTS</div>
            <ul className="ag-print-files">
              {data.attachments.map((att) => (
                <li key={att.id}>
                  <span>{att.name}</span>
                  <span className="ag-print-file-meta">{fmtSize(att.size)} · SHA-256 {String(att.sha256).slice(0, 16)}…</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="ag-print-endnote">（以下无正文）</p>

        <div className="ag-sign-block">
          <div className="ag-mono">{a.completedAt ? "签署" : "签署（进行中）"}</div>
          <p style={{ margin: "10px 0 0", fontSize: "9.5pt", lineHeight: 1.7, color: "#333" }}>{localized(a, "consentText")}</p>
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
            {(() => {
              // Silence is ambiguous: a missing timestamp line could mean "TSA
              // was down" or "the page forgot it". Say it out loud.
              const signed = data.signers.filter((s) => s.signedAt);
              const missing = signed.filter((s) => !s.tsaTime);
              if (!signed.length || !missing.length) return null;
              return (
                <div className="ag-finger">
                  第三方时间戳　未获取（{missing.length === signed.length ? "时间戳服务不可用" : missing.map((s) => s.label || "签署人").join("、") + " 未获取"}）
                </div>
              );
            })()}
            <div>查验方式　{verifyLine}</div>
            {layout && layout.footerNote ? <div className="pd-footer-note">{layout.footerNote}</div> : null}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
