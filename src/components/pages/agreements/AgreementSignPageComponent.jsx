"use client";

import { useCallback, useEffect, useState } from "react";
import MarkdownBody from "@/components/others/MarkdownBody";
import SignaturePad from "@/components/forms/fields/SignaturePadField";
import { localized } from "@/lib/agreementLocale";

const fmtSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const ipLabel = (ip) => (!ip ? "" : /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(String(ip)) ? "本机" : ip);

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
      })
    : "—";

export default function SignPage({ token }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSigned, setJustSigned] = useState(false);
  const [weChat, setWeChat] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declining, setDeclining] = useState(false);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const r = await fetch(`/api/sign/${token}`, { cache: "no-store" });
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

  // WeChat's in-app browser can block canvas gestures; tell the signer to move
  // to a real browser instead of letting them fail silently.
  useEffect(() => {
    try { setWeChat(/MicroMessenger/i.test(navigator.userAgent)); } catch { /* ignore */ }
  }, []);

  async function decline() {
    if (declining) return;
    setDeclining(true);
    setError("");
    try {
      const r = await fetch(`/api/sign/${token}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "提交失败");
      setDeclineOpen(false);
      setDeclineReason("");
      await load({ quiet: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setDeclining(false);
    }
  }

  async function sign() {
    if (!image || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/sign/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, contentHash: view?.agreement?.contentHash }),
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
  const expired = a.status === "EXPIRED";
  const declined = a.status === "DECLINED";

  return (
    <div className="ag-root">
      <div className="ag-sign-layout">
      <div className="ag-doc-page">
        {weChat ? (
          <div
            style={{
              margin: "0 0 18px",
              padding: "12px 14px",
              border: "1px solid #f0d9a8",
              background: "#fff8e6",
              borderRadius: 8,
              lineHeight: 1.6,
              fontSize: 14,
            }}
          >
            微信内置浏览器可能无法正常签名。请点右上角 “⋯”，选择“在浏览器打开”后再签署。
            <span style={{ display: "block", marginTop: 6, fontSize: 13 }}>
              WeChat may block signing. Tap “⋯” → “Open in Browser”.
            </span>
          </div>
        ) : null}
        <div className="ag-doc-top">
          <div className="ag-mono">
            {a.number} · {completed ? "已完成" : declined ? "已被拒绝" : expired ? "已到期" : me?.signed ? "你已签署" : "待签署"}
          </div>
          {signedCount > 0 ? (
            <a className="ag-btn ag-btn--small" href={`/api/sign/${token}/pdf`}>
              {completed ? "下载 PDF" : me?.signed ? "下载当前副本" : "下载 PDF"}
            </a>
          ) : null}
        </div>
        <h1
          className="ag-doc-title"
          style={String(localized(a, "title") || "").length > 60 ? { fontSize: "20px", lineHeight: 1.4, wordBreak: "break-word" } : undefined}
        >
          {localized(a, "title")}
        </h1>
        <div className="ag-doc-meta ag-mono">
          <span>签署人 {me?.label || ""}</span>
          <span>发出 {fmt(a.sentAt)}</span>
          <span>{a.expiresAt ? `截止 ${fmt(a.expiresAt)}` : "无截止日期"}</span>
          <span>{signedCount} / {signers.length} 已签</span>
        </div>

        {/* Arbitrary template content — signatures live outside this block. */}
        <div className="ag-prose ag-contract" style={{ marginTop: 30 }}>
          <MarkdownBody markdown={localized(a, "body")} title={localized(a, "title")} />
        </div>

        <div className="ag-signature-section" id="sign-area">
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
                  ) : s.declined ? (
                    <div className="ag-sig-empty">
                      <span className="ag-mono">已拒绝</span>
                    </div>
                  ) : s.isMe && !expired && !declined ? (
                    <div className="ag-sig-draw">
                      <p className="ag-consent">{localized(a, "consentText")}</p>
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

          {expired ? (
            <p className="ag-alert" style={{ marginTop: 18 }}>
              合同已到期，无法签署。请联系发起人重新发出或续签。
            </p>
          ) : null}

          {declined ? (
            <p className="ag-alert" style={{ marginTop: 18 }}>
              这份合同已被拒绝签署，不能再签。{a.declineReason ? "理由：" + a.declineReason : ""}
              请联系发起人重新发出。
            </p>
          ) : null}

          {view.canSign ? (
            <div style={{ marginTop: 22 }}>
              {declineOpen ? (
                <div style={{ border: "1px solid #e6e6e1", borderRadius: 8, padding: 14, background: "#fff" }}>
                  <div className="ag-mono" style={{ marginBottom: 8 }}>拒绝理由（选填，最多 500 字）</div>
                  <textarea
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value.slice(0, 500))}
                    rows={3}
                    style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}
                    placeholder="例如：价格条款需要再谈"
                  />
                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <button className="ag-btn ag-btn--ghost" onClick={() => setDeclineOpen(false)} disabled={declining}>
                      取消
                    </button>
                    <button className="ag-btn" style={{ background: "#8a1c1c" }} onClick={decline} disabled={declining}>
                      {declining ? "提交中…" : "确认拒绝签署"}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="aw-text-btn" onClick={() => setDeclineOpen(true)}>
                  不同意？拒绝签署
                </button>
              )}
            </div>
          ) : null}

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

        {!completed && !declined && !expired ? (
          <div className="ag-sticky">
            <span className="ag-mono">{signedCount} / {signers.length} 已签</span>
            {me?.signed ? (
              <a className="ag-btn" href={`/api/sign/${token}/pdf`}>下载当前副本</a>
            ) : (
              <button
                className="ag-btn ag-btn--primary"
                onClick={() => document.getElementById("sign-area")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >去签名</button>
            )}
          </div>
        ) : null}

        <div className="ag-doc-foot">
          <span className="ag-mono">{a.number}</span>
          <span className="ag-mono">{completed ? "COMPLETED" : `${signedCount} / ${signers.length}`}</span>
        </div>
      </div>

      <aside className="ag-side">
        <div className="ag-side-block">
          <div className="ag-mono">状态</div>
          <div className="ag-side-state">
            {completed ? "已完成" : declined ? "已被拒绝" : expired ? "已到期" : me?.signed ? "你已签署" : "待签署"}
          </div>
          <div className="ag-sub" style={{ marginTop: 6 }}>{signedCount} / {signers.length} 已签</div>
          <ul className="ag-side-signers">
            {signers.map((s) => (
              <li key={s.id}>
                <span className="ag-side-name">
                  {s.label || "签署人"}
                  {s.isMe ? <span className="ag-you">你</span> : null}
                </span>
                <span className="ag-mono">{s.signed ? "已签" : s.declined ? "已拒绝" : "待签"}</span>
              </li>
            ))}
          </ul>
        </div>

        {view.attachments?.length ? (
          <div className="ag-side-block">
            <div className="ag-mono" style={{ marginBottom: 10 }}>附件 · {view.attachments.length}</div>
            <ul className="ag-side-files">
              {view.attachments.map((att) => (
                <li key={att.id}>
                  <a href={`/api/sign/${token}/attachments/${att.id}`} target="_blank" rel="noreferrer">{att.name}</a>
                  <span className="ag-mono">{fmtSize(att.size)}</span>
                </li>
              ))}
            </ul>
            <p className="ag-note" style={{ marginTop: 10 }}>附件是合同的一部分，下载后可核对摘要。</p>
          </div>
        ) : null}

        <div className="ag-side-block">
          <div className="ag-mono" style={{ marginBottom: 10 }}>操作</div>
          {signedCount > 0 ? (
            <a className="ag-btn ag-btn--ghost ag-btn--small" style={{ display: "inline-flex" }} href={`/api/sign/${token}/pdf`}>
              {completed ? "下载 PDF" : me?.signed ? "下载当前副本" : "下载 PDF"}
            </a>
          ) : null}
          <a className="aw-text-btn" style={{ marginLeft: signedCount > 0 ? 16 : 0 }} href="/verify">核验签署记录</a>
        </div>
      </aside>
    </div>
    </div>
  );
}
