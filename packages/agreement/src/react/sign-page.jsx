"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SignaturePad from "./signature-pad.jsx";

const ipLabel = (ip) => (!ip ? "" : /^(::1|127\.0\.0\.1)$/.test(String(ip)) ? "本机" : ip);

const fmtTsa = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
};

const fmt = (d) =>
  d
    ? new Date(d).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

export default function SignPage({ token, apiBase = "/api/sign" }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSigned, setJustSigned] = useState(false);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const r = await fetch(`${apiBase}/${token}`, { cache: "no-store" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "链接无效");
        setView(d);
        return d;
      } catch (e) {
        if (!quiet) setError(e.message);
        return null;
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    load();
  }, [load]);

  // The other party may sign at any time: keep this copy fresh.
  useEffect(() => {
    const id = setInterval(() => load({ quiet: true }), 6000);
    const onFocus = () => load({ quiet: true });
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function sign() {
    if (!image || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${apiBase}/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存失败");
      setImage("");
      setJustSigned(true);
      await load({ quiet: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !view) {
    return (
      <div className="ag-root">
        <div className="ag-wrap ag-wrap--narrow" style={{ paddingTop: 120 }}>
          <div className="ag-mono">Loading…</div>
        </div>
      </div>
    );
  }

  if (error && !view) {
    return (
      <div className="ag-root">
        <div className="ag-wrap ag-wrap--narrow" style={{ paddingTop: 120 }}>
          <div className="ag-mono">Link</div>
          <h1 className="ag-h1" style={{ fontSize: 30 }}>链接无效</h1>
          <p className="ag-sub" style={{ marginTop: 14 }}>{error}</p>
        </div>
      </div>
    );
  }

  const a = view.agreement;
  const signers = view.signers || [];
  const me = signers.find((s) => s.isMe);
  const signedCount = signers.filter((s) => s.signed).length;
  const completed = a.status === "COMPLETED";

  return (
    <div className="ag-root">
      <div className="ag-doc-page">
        <div className="ag-doc-top">
          <div className="ag-mono">
            {a.number} · {completed ? "已完成" : me?.signed ? "你已签署" : "待签署"}
          </div>
          {signedCount > 0 ? (
            <a className="ag-btn ag-btn--small" href={`${apiBase}/${token}/pdf`}>
              {completed ? "下载 PDF" : me?.signed ? "下载当前副本" : "下载 PDF"}
            </a>
          ) : null}
        </div>
        <h1 className="ag-doc-title">{a.title}</h1>
        <div className="ag-doc-meta ag-mono">
          <span>签署人 {me?.label || ""}</span>
          <span>发出 {fmt(a.sentAt)}</span>
          <span>{a.expiresAt ? `截止 ${fmt(a.expiresAt)}` : "无截止日期"}</span>
          <span>{signedCount} / {signers.length} 已签</span>
        </div>

        {/* Arbitrary template content — signatures live outside this block. */}
        <div className="ag-prose" style={{ marginTop: 30 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.body || ""}</ReactMarkdown>
        </div>

        <div className="ag-signature-section">
          <div className="ag-mono" style={{ marginBottom: 18 }}>签署</div>

          <div className="ag-sig-grid">
            {signers.map((s) => {
              const isMyOpenBlock = s.isMe && !s.signed;
              return (
                <div className={`ag-sig-block${isMyOpenBlock ? " ag-sig-block--me" : ""}`} key={s.id}>
                  <div className="ag-sig-block-head">
                    <span>{s.label || "签署人"}</span>
                    <span className="ag-mono">{s.isMe ? "你" : s.signed ? "已签" : "待签"}</span>
                  </div>

                  {s.signed ? (
                    <>
                      <img src={s.image} alt={`${s.label || "签署人"}的签名`} className="ag-sig-block-img" />
                      <div className="ag-sig-record">
                        <div>{fmt(s.signedAt)}</div>
                        {s.signedIp ? <div>IP {ipLabel(s.signedIp)}</div> : null}
                        {s.tsaTime ? <div>时间戳 {fmtTsa(s.tsaTime)}（UTC+8）</div> : null}
                        {s.signatureHash ? (
                          <div>
                            记录编号 {s.signatureHash.slice(0, 16).toUpperCase()}
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : s.isMe ? (
                    <div className="ag-sig-draw">
                      <p className="ag-consent">{a.consentText}</p>
                      <SignaturePad value={image} onChange={setImage} height={190} />
                      <div className="ag-sig-draw-actions">
                        <span className="ag-note">
                          {busy ? "正在保存…" : "在框内签名（可多次连笔），确认内容后点“同意并签署”。"}
                        </span>
                        <button className="ag-btn" onClick={sign} disabled={!image || busy}>
                          {busy ? "保存中…" : "同意并签署"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ag-sig-empty">
                      <span className="ag-mono">待签署</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error ? <p className="ag-alert">{error}</p> : null}

          {completed ? (
            <p className="ag-note" style={{ marginTop: 26 }}>
              全部签署人已完成签署。这份副本包含每个人的签名、时间与指纹。
            </p>
          ) : justSigned ? (
            <p className="ag-note" style={{ marginTop: 26 }}>
              你的签名已保存。其他人签完后，这份合同会自动完成。
            </p>
          ) : null}
        </div>

        <div className="ag-doc-foot">
          <span className="ag-mono">{a.number}</span>
          <span className="ag-mono">{completed ? "COMPLETED" : `${signedCount} / ${signers.length}`}</span>
        </div>
      </div>
    </div>
  );
}
