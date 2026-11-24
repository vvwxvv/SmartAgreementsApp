"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { findPlaceholders, describePlaceholders } from "@/lib/contractChecks";
import { expiryState, termState } from "@/lib/expiryLabel";
import { useModalA11y } from "@/lib/useModalA11y";
import AwSelect from "@/components/forms/AwSelect";
import MarkdownBody from "@/components/others/MarkdownBody";
import { AI_EXPORT_PROMPT, AI_EMPTY_TEMPLATE, AI_SPEC_VERSION } from "@/lib/aiExportSpec";
import { contentChecks } from "@/lib/contentChecks";
import { parseContract, composeContract, toChinese, numberingIssues, referenceIssues, findSignatureTables, stripSignatureTables, CONTRACT_TEMPLATES, templateById } from "@/lib/contractSections";

const DEFAULT_CONSENT = "我已阅读并同意本合同，自愿以电子方式签署。";

const T = {
  title: { en: "Management", cn: "管理系统" },
  agreements: { en: "Agreements", cn: "协议" },
  parties: { en: "Parties", cn: "主体" },
  newAgreement: { en: "New agreement", cn: "新建协议" },
  newParty: { en: "New party", cn: "新建主体" },
  loading: { en: "Loading…", cn: "加载中…" },
  empty: { en: "Nothing here yet.", cn: "暂无数据。" },
  save: { en: "Save", cn: "保存" },
  send: { en: "Send", cn: "发送" },
  links: { en: "Links", cn: "签署链接" },
  copy: { en: "Copy", cn: "复制" },
  copied: { en: "Copied", cn: "已复制" },
  archive: { en: "Archive", cn: "归档" },
  open: { en: "Open", cn: "打开" },
  close: { en: "Close", cn: "关闭" },
  sendNow: { en: "Send immediately", cn: "立即发送" },
  signers: { en: "Signers", cn: "签署方" },
  events: { en: "Events", cn: "事件" },
  signed: { en: "signed", cn: "已签" },
  pending: { en: "pending", cn: "待签" },
};

const label = {
  DRAFT: { en: "DRAFT", cn: "草稿" },
  SENT: { en: "SENT", cn: "已发送" },
  COMPLETED: { en: "COMPLETED", cn: "已完成" },
  VOID: { en: "VOID", cn: "已作废" },
  DECLINED: { en: "DECLINED", cn: "已被拒绝" },
  EXPIRED: { en: "EXPIRED", cn: "已过期" },
};

// Local wall-clock time (the ISO string from the API is UTC).
const EVENT_ZH = { "draft.created": "创建草稿", sent: "已发出", signed: "已签署", completed: "已完成", voided: "已作废", declined: "已拒绝", "expiry.extended": "已延期", "term.changed": "改期限", renewed: "已续签", linksViewed: "查看链接", signedAfterVoid: "作废后签署被拒" };
const eventLabel = (type) => EVENT_ZH[type] || type;
const fmtSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);

const fmt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const names = (p) => (p ? [p.name, p.nameEn].filter(Boolean).join(" / ") : "—");

/** 粘贴的 TSV（Excel 复制）/ CSV → Markdown 表格。第一行当表头。 */
function tableFromText(text) {
  const rows = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t").length > 1 ? line.split("\t") : line.split(","));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (c) => String(c || "").trim().replace(/\|/g, "\\|");
  const line = (cells) => "| " + cells.map(cell).join(" | ") + " |";
  const filled = rows.map((r) => [...r.map(cell), ...Array(width - r.length).fill("")]);
  const head = filled[0];
  const body = filled.slice(1);
  return [line(head), "| " + Array(width).fill("---").join(" | ") + " |", ...body.map(line)].join("\n");
}

/** 空表：n 行（含表头）× m 列。 */
function emptyTable(rows, cols, withHeader = true) {
  const r = Math.max(2, Number(rows) || 3);
  const c = Math.max(2, Number(cols) || 3);
  const head = withHeader ? Array.from({ length: c }, (_, i) => "列 " + (i + 1)) : Array(c).fill("");
  const lines = [
    "| " + head.join(" | ") + " |",
    "| " + Array(c).fill("---").join(" | ") + " |",
  ];
  for (let i = 0; i < r - 1; i += 1) lines.push("| " + Array(c).fill("").join(" | ") + " |");
  return lines.join("\n");
}


export default function ManagerPage() {
  const [cn, setCn] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem("ag.cn") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("ag.cn", cn ? "1" : "0"); } catch { /* storage blocked */ }
  }, [cn]);
  const [tab, setTab] = useState("agreements");
  const [newSignal, setNewSignal] = useState(0);
  const [navOpen, setNavOpen] = useState(true);          // 左侧栏（仅桌面）
  const [statusFilter, setStatusFilter] = useState("ALL"); // 侧栏状态筛选，与列表共用
  const [agreements, setAgreements] = useState([]);
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(null);
  const [detail, setDetail] = useState(null);
  const [links, setLinks] = useState(null);
  const [copied, setCopied] = useState("");
  const [detailMsg, setDetailMsg] = useState("");
  const [attErr, setAttErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [renewSeed, setRenewSeed] = useState(null);
  const detailRef = useModalA11y(Boolean(detail), () => { setDetail(null); setLinks(null); });
  const [seedInfo, setSeedInfo] = useState(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedDismissed, setSeedDismissed] = useState(false);
  const [seedJustCleared, setSeedJustCleared] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/manager/seed-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setSeedInfo(d); })
      .catch(() => { /* 状态探测失败不影响使用 */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!seedInfo?.seededAt) return;
    try { setSeedDismissed(window.localStorage.getItem("ag.seed." + seedInfo.seededAt) === "1"); } catch { /* blocked */ }
  }, [seedInfo?.seededAt]);

  const clearSeed = async () => {
    if (!window.confirm("清空示例数据？只会删除导入的示例记录，你自己创建的合同与主体不受影响。")) return;
    setSeedBusy(true);
    try {
      const r = await fetch("/api/manager/seed-status", { method: "DELETE" });
      if (r.ok) { setSeedInfo({ seeded: false }); setSeedJustCleared(true); await loadAll(); }
    } finally { setSeedBusy(false); }
  };

  const t = (n) => (cn ? n.cn : n.en);
  const expiryText = (iso) => {
    const s = expiryState(iso);
    if (s.state === "none") return "—";
    if (s.state === "expired") return t({ en: "expired", cn: "已到期" });
    if (s.state === "soon") return t({ en: "soon (" + s.days + "d)", cn: "即将到期（" + s.days + " 天）" });
    return t({ en: "valid (" + s.days + "d)", cn: "有效（" + s.days + " 天）" });
  };
  const total = agreements.length + parties.length;

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [a, p] = await Promise.all([
        fetch("/api/manager/agreements", { cache: "no-store" }),
        fetch("/api/manager/party-info", { cache: "no-store" }),
      ]);
      if (a.status === 401 || p.status === 401) {
        setStatus(401);
        return;
      }
      const aj = await a.json().catch(() => ({}));
      const pj = await p.json().catch(() => ({}));
      setAgreements(Array.isArray(aj.agreements) ? aj.agreements : []);
      setParties(Array.isArray(pj.parties) ? pj.parties : []);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const openDetail = async (id) => {
    setDetail({ id, loading: true });
    setDetailMsg("");
    setLinks(null);
    try {
      const [d, l] = await Promise.all([
        fetch(`/api/manager/agreements/${id}`, { cache: "no-store" }),
        fetch(`/api/manager/agreements/${id}/links`, { cache: "no-store" }),
      ]);
      const dj = await d.json().catch(() => ({}));
      const lj = l.json ? await l.json().catch(() => ({})) : {};
      setDetail({ id, ...dj, loading: false });
      setLinks(lj);
    } catch (e) {
      // 请求失败也必须退出 loading，否则弹层永远停在骨架屏（按钮全隐藏 = 卡死）
      setDetail({ id, loading: false });
      setDetailMsg(String((e && e.message) || e || "加载失败"));
    }
  };

  // Link lifetime is capped at 30 days from the first send (server rule, see
  // terms.js). Clamp here too: "+30d" clicked a minute after sending used to be
  // rejected with a 400 and no feedback at all.
  const extendBy = async (days) => {
    if (!detail?.id) return;
    setDetailMsg("");
    const a = detail.agreement || {};
    const sentMs = a.sentAt ? new Date(a.sentAt).getTime() : null;
    const currentMs = a.expiresAt ? new Date(a.expiresAt).getTime() : null;
    let targetMs = Date.now() + days * 86400000;
    if (sentMs) targetMs = Math.min(targetMs, sentMs + 30 * 86400000);
    if (currentMs && targetMs <= currentMs) {
      setDetailMsg(t({ en: "Link lifetime is capped at 30 days from the first send — already at the limit.", cn: "链接总有效期最多 30 天（自首次发送起），已到上限。" }));
      return;
    }
    const r = await fetch("/api/manager/agreements/" + detail.id + "/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signDeadline: new Date(targetMs).toISOString() }),
    });
    if (r.ok) { await openDetail(detail.id); loadAll(); return; }
    const j = await r.json().catch(() => ({}));
    setDetailMsg(j.error || t({ en: "Extend failed.", cn: "延期失败。" }));
  };

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(""), 1200);
    } catch { /* clipboard blocked */ }
  };

  if (status === 401) {
    return (
      <div className="ag-root">
        <div className="ag-wrap ag-wrap--narrow" style={{ paddingTop: 72 }}>
          <div className="ag-mono">Agreement · Admin</div>
          <h1 className="ag-h1" style={{ fontSize: 34 }}>{t({ en: "SIGN IN REQUIRED", cn: "需要登录" })}</h1>
          <p className="ag-sub" style={{ marginTop: 12 }}>
            {t({ en: "Unlock the admin gate first.", cn: "请先在管理入口解锁。" })}
          </p>
          <Link className="ag-btn ag-btn--primary" style={{ marginTop: 20 }} href="/admin/login">
            {t({ en: "Go to admin gate", cn: "前往管理入口" })}
          </Link>
        </div>
      </div>
    );
  }

  const firstLoad = loading && !agreements.length && !parties.length;
  const statusCounts = {
    ALL: agreements.length,
    DRAFT: agreements.filter((a) => a.status === "DRAFT").length,
    SENT: agreements.filter((a) => a.status === "SENT").length,
    COMPLETED: agreements.filter((a) => a.status === "COMPLETED").length,
    DECLINED: agreements.filter((a) => a.status === "DECLINED").length,
    VOIDED: agreements.filter((a) => a.status === "VOIDED").length,
  };

  return (
    <div className="ag-root">
      <div className={"aw-shell" + (navOpen ? "" : " is-closed")}>
        <aside className="aw-side" aria-label="Sidebar">
          <div className="aw-side-head">
            <div className="aw-kicker">Agreement<br />Manager</div>
            <button
              type="button"
              className="aw-side-toggle"
              onClick={() => setNavOpen(false)}
              title={t({ en: "Hide sidebar", cn: "收起侧栏" })}
              aria-label={t({ en: "Hide sidebar", cn: "收起侧栏" })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          </div>

          <nav className="aw-side-nav">
            <button
              type="button"
              className={"aw-side-item" + (tab === "agreements" ? " is-on" : "")}
              onClick={() => setTab("agreements")}
            >
              <span className={"aw-side-mark" + (tab === "agreements" ? " is-on" : "")} aria-hidden="true" />
              {firstLoad ? <span className="sk sk-nav" aria-hidden="true" /> : <>{t(T.agreements)}<sup>{agreements.length}</sup></>}
            </button>
            <button
              type="button"
              className={"aw-side-item" + (tab === "parties" ? " is-on" : "")}
              onClick={() => setTab("parties")}
            >
              <span className={"aw-side-mark" + (tab === "parties" ? " is-on" : "")} aria-hidden="true" />
              {firstLoad ? <span className="sk sk-nav" aria-hidden="true" /> : <>{t(T.parties)}<sup>{parties.length}</sup></>}
            </button>
          </nav>

          <div className="aw-side-group">{t({ en: "Status", cn: "状态" })}</div>
          <div className="aw-side-status">
            {[["ALL", "All", "全部"], ["DRAFT", "Draft", "草稿"], ["SENT", "Sent", "已发送"], ["COMPLETED", "Completed", "已完成"], ["DECLINED", "Declined", "已拒绝"], ["VOIDED", "Voided", "已作废"]].map(([key, en, zh]) => (
              <button
                key={key}
                type="button"
                className={"aw-side-status-row" + (statusFilter === key && tab === "agreements" ? " is-on" : "")}
                onClick={() => { setTab("agreements"); setStatusFilter(key); }}
              >
                {firstLoad ? <span className="sk sk-nav sk-nav--sm" aria-hidden="true" /> : <span>{t({ en, cn: zh })}</span>}
                {firstLoad ? <span className="sk sk-count" aria-hidden="true" /> : <span className="aw-side-count">{statusCounts[key]}</span>}
              </button>
            ))}
          </div>

          <div className="aw-side-foot">
            <button
              type="button"
              className="aw-lang"
              onClick={() => setCn((v) => !v)}
              aria-label={cn ? "Switch to English" : "切换到中文"}
            >{cn ? "EN" : "中文"}</button>
          </div>
        </aside>

      <div className="aw-wrap" style={{ paddingTop: 36, paddingBottom: 80 }}>
        {!navOpen ? (
          <button
            type="button"
            className="aw-side-open"
            onClick={() => setNavOpen(true)}
            title={t({ en: "Show sidebar", cn: "展开侧栏" })}
            aria-label={t({ en: "Show sidebar", cn: "展开侧栏" })}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        ) : null}

        {seedInfo?.seeded && !seedDismissed ? (
          <div className="aw-banner" role="status">
            <div>
              <b>示例数据已载入</b>
              <span>
                {" "}· {seedInfo.counts?.Agreement || 0} 份协议、{seedInfo.counts?.PartyInfo || 0} 个主体来自 <code>{seedInfo.source || "data/csv"}</code>，
                仅用于试用；正式使用前请清空。
              </span>
            </div>
            <div className="aw-banner-actions">
              <button className="aw-text-btn" disabled={seedBusy} onClick={clearSeed}>{seedBusy ? "清理中…" : "清空示例数据"}</button>
              <button
                className="aw-text-btn"
                onClick={() => {
                  setSeedDismissed(true);
                  try { window.localStorage.setItem("ag.seed." + seedInfo.seededAt, "1"); } catch { /* blocked */ }
                }}
              >知道了</button>
            </div>
          </div>
        ) : null}

        <div className="aw-tabs">
          {["agreements", "parties"].map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={"aw-tab" + (tab === key ? " is-on" : "")}
              aria-selected={tab === key}
              role="tab"
            >
              {t(T[key])}<sup className="aw-tab-count">{key === "agreements" ? agreements.length : parties.length}</sup>
            </button>
          ))}
        </div>

        {(() => {
          const soon = agreements.filter((a) => {
            if (a.status !== "COMPLETED") return false;
            const s = termState({ status: a.status, termEnd: a.termEnd, renewalStatus: a.renewalStatus, renewalDeadline: a.renewalDeadline });
            return s.state === "soon" || s.state === "expired" || s.state === "renewal-expired";
          });
          if (!soon.length) return null;
          return (
            <p className="ag-alert" style={{ marginTop: 16 }}>
              {t({ en: "Needs renewal", cn: "待续签" })}: {soon.length} · {soon.slice(0, 3).map((a) => a.number).join(", ")}
            </p>
          );
        })()}

        {error ? <p className="ag-alert" style={{ marginTop: 16 }}>{error}</p> : null}
        {loading && !firstLoad ? <div className="aw-loadbar" role="status" aria-label={t({ en: "Refreshing", cn: "刷新中" })}><span /></div> : null}
        {firstLoad ? <ListSkeleton t={t} /> : null}

        {!loading && tab === "agreements" ? (
          <AgreementsTab
            t={t} cn={cn} rows={agreements} parties={parties}
            renewSeed={renewSeed}
            justCleared={seedJustCleared}
            onRenewConsumed={() => setRenewSeed(null)}
            onCreated={(id) => { loadAll(); openDetail(id); }}
            onGotoParties={() => setTab("parties")}
            newSignal={newSignal}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
          />
        ) : null}

        {!loading && tab === "parties" ? (
          <PartiesTab t={t} cn={cn} rows={parties} onCreated={loadAll} />
        ) : null}

      </div>
      </div>

      {detail ? (
        <div className="ag-modal" onClick={() => { setDetail(null); setLinks(null); }}>
          <div className={"ag-modal-card" + (detail.loading ? " is-loading" : "")} ref={detailRef} role="dialog" aria-modal="true" aria-label={t({ en: "Agreement detail", cn: "协议详情" })} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <button className="ag-modal-close" onClick={() => { setDetail(null); setLinks(null); }}>X</button>
            <div className="ag-modal-body">
              {detail.loading ? (
                <div className="sk-detail" aria-busy="true">
                  <div className="sk sk-num" />
                  <div className="sk sk-title" style={{ width: "62%", height: 28, marginTop: 16 }} />
                  <div className="sk sk-line" style={{ marginTop: 22 }} />
                  <div className="sk sk-line" style={{ width: "88%", marginTop: 10 }} />
                  <div className="sk sk-line" style={{ width: "74%", marginTop: 10 }} />
                  <div className="sk sk-line" style={{ width: "52%", marginTop: 26 }} />
                </div>
              ) : (
                <>
                  <div className="ag-mono">{detail.agreement?.number || detail.id}</div>
                  <h2 style={{ margin: "6px 0 10px", fontSize: 22 }}>{detail.agreement?.title || "—"}</h2>
                  <div className="ag-doc-meta">
                    <span>{label[detail.agreement?.status] ? t(label[detail.agreement.status]) : detail.agreement?.status}</span>
                    <span>{fmt(detail.agreement?.createdAt)}</span>
                    <span>{(detail.signers || []).filter((s) => s.signed).length}/{(detail.signers || []).length} {t(T.signed)}</span>
                    <span>{t({ en: "sign by", cn: "签署截止" })}: {fmt(detail.agreement?.signDeadline || detail.agreement?.expiresAt)}</span>
                    <span>{t({ en: "term ends", cn: "合同到期" })}: {fmt(detail.agreement?.termEnd)}{detail.agreement?.renewedBy ? " · " + t({ en: "renewed", cn: "已续签" }) : ""}</span>
                  </div>

                  <h3 className="ag-h2" style={{ marginTop: 22 }}>{t(T.signers)}</h3>
                  <table className="ag-table aw-signers-table">
                    <thead><tr><th>#</th><th>{t({ en: "Name", cn: "名称" })}</th><th>{t({ en: "Email", cn: "邮箱" })}</th><th>{t({ en: "State", cn: "状态" })}</th></tr></thead>
                    <tbody>
                      {(detail.signers || []).map((s, i) => (
                        <tr key={s.id || i} className="aw-hover-row aw-hover-row--static">
                          <td className="aw-signer-num">{i + 1}</td>
                          <td className="aw-signer-name">{s.label || s.email || "—"}</td>
                          <td className="aw-signer-email">{s.email || "—"}</td>
                          <td className="aw-signer-state">{s.signed ? t(T.signed) : t(T.pending)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {detail.agreement ? (
                    <>
                      <h3 className="ag-h2" style={{ marginTop: 22 }}>{t({ en: "Attachments", cn: "附件" })}</h3>
                      {(detail.agreement.attachments || []).length ? (
                        <ul className="ag-mini">
                          {(detail.agreement.attachments || []).map((att) => (
                            <li key={att.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                              <a href={`/api/manager/agreements/${detail.id}/attachments/${att.id}`} style={{ textDecoration: "underline" }}>{att.name}</a>
                              <span className="ag-mono" style={{ opacity: 0.6 }}>{fmtSize(att.size)} · {String(att.sha256).slice(0, 12)}…</span>
                              {detail.agreement.status === "DRAFT" ? (
                                <button className="aw-text-btn" onClick={async () => {
                                  const r = await fetch(`/api/manager/agreements/${detail.id}/attachments/${att.id}`, { method: "DELETE" });
                                  if (r.ok) await openDetail(detail.id); else setAttErr((await r.json().catch(() => ({}))).error || "删除失败");
                                }}>{t({ en: "Remove", cn: "删除" })}</button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="ag-sub">{t({ en: "No attachments.", cn: "暂无附件。" })}</p>
                      )}
                      {detail.agreement.status === "DRAFT" ? (
                        <div style={{ marginTop: 10 }}>
                          <label className="ag-btn ag-btn--ghost ag-btn--small" style={{ cursor: "pointer", display: "inline-flex" }}>
                            {uploading ? t({ en: "Uploading…", cn: "上传中…" }) : t({ en: "Choose file", cn: "选择文件" })}
                          <input
                            type="file"
                            multiple
                            style={{ display: "none" }}
                            disabled={uploading}
                            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx"
                            onChange={async (e) => {
                              const files = [...(e.target.files || [])];
                              if (!files.length) return;
                              setAttErr(""); setUploading(true);
                              try {
                                for (const f of files) {
                                  if (f.size > 5 * 1024 * 1024) { setAttErr(`${f.name} 超过 5 MB`); continue; }
                                  const data = await new Promise((resolve, reject) => {
                                    const fr = new FileReader();
                                    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
                                    fr.onerror = () => reject(new Error("读取文件失败"));
                                    fr.readAsDataURL(f);
                                  });
                                  const ext = (f.name.split(".").pop() || "").toLowerCase();
                                  const guess = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }[ext] || "";
                                  const r = await fetch(`/api/manager/agreements/${detail.id}/attachments`, {
                                    method: "POST", headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ name: f.name, mime: f.type || guess, data }),
                                  });
                                  if (!r.ok) { const j = await r.json().catch(() => ({})); setAttErr(j.error || `${f.name} 上传失败`); }
                                }
                                await openDetail(detail.id);
                              } finally { setUploading(false); e.target.value = ""; }
                            }}
                          />
                          </label>
                          <p className="ag-note" style={{ marginTop: 6 }}>
                            {t({ en: "PDF/PNG/JPG/WEBP/TXT/DOCX/XLSX, up to 5 files, 5 MB each. Frozen after sending.", cn: "支持 PDF/PNG/JPG/WEBP/TXT/DOCX/XLSX；最多 5 个、单个 5 MB；发出后不可修改。" })}
                          </p>
                        </div>
                      ) : null}
                      {attErr ? <p className="ag-alert" style={{ marginTop: 8 }}>{attErr}</p> : null}
                    </>
                  ) : null}

                  {links && (links.links?.length || links.legacy) ? (
                    <>
                      <h3 className="ag-h2" style={{ marginTop: 22 }}>{t(T.links)}</h3>
                      {(links.links || []).map((l) => (
                        <div className="ag-linkbox" key={l.url}>
                          <div className="ag-mono" style={{ marginBottom: 6, opacity: 0.7 }}>{l.label || l.email}</div>
                          <code className="ag-link-url">{l.url}</code>
                          <div className="ag-link-actions">
                            <button className="ag-btn ag-btn--small ag-btn--ghost" onClick={() => copy(l.url)}>
                              {copied === l.url ? t(T.copied) : t(T.copy)}
                            </button>
                          </div>
                        </div>
                      ))}
                      {links.legacy ? <p className="ag-sub">{t({ en: "Legacy link (re-send to rotate).", cn: "旧版链接（重新发送可轮换）。" })}</p> : null}
                    </>
                  ) : null}

                  {detail.events?.length ? (
                    <details className="ag-fold">
                      <summary className="ag-fold-head">
                        <span className="ag-fold-title">{t(T.events)} · {detail.events.length}</span>
                        <span className="ag-fold-caret" aria-hidden="true" />
                      </summary>
                      <div className="ag-fold-body">
                        <ul className="ag-mini">
                          {detail.events.map((e, i) => (
                            <li key={i}>{fmt(e.at)} · {eventLabel(e.type)}</li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  ) : null}

                  {detail.agreement?.body ? (
                    <details className="ag-fold" style={{ marginTop: 20 }}>
                      <summary className="ag-fold-head"><span className="ag-fold-title">{t({ en: "Body", cn: "正文" })}</span><span className="ag-fold-caret" aria-hidden="true" /></summary>
                      <div className="ag-fold-body"><div className="ag-prose"><MarkdownBody markdown={detail.agreement.body} title={detail.agreement.title} /></div></div>
                    </details>
                  ) : null}
                </>
              )}
            </div>
            {detailMsg ? <p className="ag-alert" style={{ margin: "0 0 10px" }}>{detailMsg}</p> : null}
            <div className="ag-modal-actions">
              {detail.agreement && (detail.agreement.status === "DRAFT" || detail.agreement.status === "SENT") ? (
                <>
                  {detail.agreement && detail.agreement.status === "DRAFT" ? (
                  <>
                    <div style={{ width: 130 }}>
                      <AwSelect
                        value=""
                        ariaLabel={t({ en: "Change contract term", cn: "修改合同期限" })}
                        placeholder={t({ en: "Term…", cn: "期限…" })}
                        options={[
                          { value: "12", label: t({ en: "1 year", cn: "1 年" }) },
                          { value: "24", label: t({ en: "2 years", cn: "2 年" }) },
                          { value: "36", label: t({ en: "3 years", cn: "3 年" }) },
                        ]}
                        onChange={async (v) => {
                          const months = Number(v);
                          if (!months || !detail?.id) return;
                          const r = await fetch("/api/manager/agreements/" + detail.id + "/term", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ termMonths: months }),
                          });
                          if (r.ok) { await openDetail(detail.id); loadAll(); }
                        }}
                      />
                    </div>
                  </>
                ) : null}
                <span className="ag-mono" style={{ alignSelf: "center", fontSize: 11, opacity: 0.6 }}>{t({ en: "extend", cn: "延期" })}</span>
                  {[7, 14, 30].map((d) => (
                    <button
                      key={d}
                      className="ag-btn ag-btn--ghost ag-btn--small"
                      onClick={() => extendBy(d)}
                      title={t({ en: `Extend the signing deadline by ${d} days`, cn: `把签署截止日期往后延 ${d} 天` })}
                      aria-label={t({ en: `Extend by ${d} days`, cn: `延期 ${d} 天` })}
                    >{cn ? `+${d} 天` : `+${d} days`}</button>
                  ))}
                </>
              ) : null}
              {detail.agreement && detail.agreement.status === "DRAFT" ? (
                <button className="ag-btn ag-btn--primary" onClick={async () => {
                  if (!detail?.id) return;
                  const r = await fetch("/api/agreements/" + detail.id + "/send", { method: "POST" });
                  if (r.ok) { await openDetail(detail.id); loadAll(); }
                }}>{t({ en: "Send", cn: "发送" })}</button>
              ) : null}
              <button className="ag-btn ag-btn--ghost" onClick={async () => {
                if (!detail?.id) return;
                const r = await fetch("/api/manager/agreements/" + detail.id + "/renew", { method: "POST" });
                const j = await r.json().catch(() => ({}));
                if (r.ok && j.id) { setDetail(null); setLinks(null); await loadAll(); await openDetail(j.id); }
              }}
                title={t({ en: "Renew: start a new draft from this agreement (fresh dates, same text)", cn: "续签：以这份合同为基础新建草稿，重新设置日期" })}
              >{t({ en: "Renew", cn: "续签" })}</button>
              <button
                className="ag-btn ag-btn--ghost"
                title={t({ en: "Copy as a new draft (same text and parties)", cn: "以同样正文和当事人新建一份草稿" })}
                onClick={async () => {
                  const a = detail.agreement || {};
                  const pa = a.parties && a.parties.partyA && a.parties.partyA.partyInfoId;
                  const pb = a.parties && a.parties.partyB && a.parties.partyB.partyInfoId;
                  const r = await fetch("/api/manager/agreements", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      title: (a.title || "") + t({ en: " (copy)", cn: "（副本）" }),
                      body: a.body,
                      consentText: a.consentText,
                      partyA: pa ? { contactId: pa } : undefined,
                      partyB: pb ? { contactId: pb } : undefined,
                    }),
                  });
                  const j = await r.json().catch(() => ({}));
                  if (r.ok && j.id) { setDetail(null); setLinks(null); await loadAll(); await openDetail(j.id); }
                  else setDetailMsg(j.error || t({ en: "Copy failed", cn: "复制失败" }));
                }}
              >{t({ en: "Duplicate", cn: "复制" })}</button>
              <a className="ag-btn ag-btn--ghost" href={`/api/agreements/${detail.id}/pdf`} target="_blank" rel="noreferrer">{t({ en: "Open PDF", cn: "打开 PDF" })}</a>
              {(detail.signers || []).some((x) => x.signed) ? (
                <a className="ag-btn ag-btn--ghost" href={`/api/manager/agreements/${detail.id}/evidence`} title={t({ en: "PDF + manifest + signatures + timestamps", cn: "PDF + 证据清单 + 签名图 + 时间戳" })}>{t({ en: "Evidence pack", cn: "证据包" })}</a>
              ) : null}
              <button className="ag-btn" onClick={() => { setDetail(null); setLinks(null); }}>{t(T.close)}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


// ─── 首次加载骨架屏 ────────────────────────────────────────────────────────
function ListSkeleton({ t }) {
  return (
    <div className="aw-list-wrap sk-wrap" aria-busy="true">
      <div className="aw-list-head">
        <div className="sk sk-title" aria-hidden="true" />
        <div className="aw-list-actions">
          <div className="sk sk-btn" aria-hidden="true" />
          <div className="sk sk-btn sk-btn--dark" aria-hidden="true" />
        </div>
      </div>
      <div className="aw-search-row">
        <div className="sk sk-search" aria-hidden="true" />
      </div>
      <div className="sk-rows">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div className="sk-row" key={i}>
            <div className="sk sk-num" aria-hidden="true" />
            <div className="sk sk-line" style={{ width: `${56 - (i % 3) * 9}%` }} aria-hidden="true" />
            <div className="sk sk-pill" aria-hidden="true" />
            <div className="sk sk-date" aria-hidden="true" />
            <div className="sk sk-date" aria-hidden="true" />
          </div>
        ))}
      </div>
      <span className="sr-only">{t({ en: "Loading agreements…", cn: "正在加载协议…" })}</span>
    </div>
  );
}

// ─── Agreements tab ────────────────────────────────────────────────────────
function AgreementsTab({ t, cn, rows, parties, onCreated, renewSeed, onRenewConsumed, justCleared = false, onGotoParties, newSignal = 0, statusFilter = "ALL", setStatusFilter = () => {} }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // 顶部「新建协议」按钮：外部信号 → 打开表单
  useEffect(() => { if (newSignal > 0) setOpen(true); }, [newSignal]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const PAGE = pageSize;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((a) => {
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (!needle) return true;
      return [a.number, a.title].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [rows, q, statusFilter]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages);
  const view = filtered.slice((current - 1) * PAGE, current * PAGE);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [created, setCreated] = useState(null);
  const [form, setForm] = useState({ title: "", body: "", consentText: DEFAULT_CONSENT, expiresAt: "", signPreset: "14", termPreset: "none", partyA: "", partyB: "", send: false });
  const [preview, setPreview] = useState(false);
  const [intro, setIntro] = useState("");
  const [sections, setSections] = useState([]);
  const formRef = useModalA11y(open, () => setOpen(false));
  const placeholders = useMemo(() => findPlaceholders(form.body), [form.body]);
  const numberIssues = useMemo(() => numberingIssues(sections), [sections]);
  const refIssues = useMemo(() => referenceIssues(sections), [sections]);
  const bodyRefs = useRef({});
  const [tbl, setTbl] = useState(null); // { index, text, rows, cols }
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const importRef = useRef(null);
  const [specOpen, setSpecOpen] = useState(false);
  const [copiedSpec, setCopiedSpec] = useState("");

  const copyText = async (text, tag) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSpec(tag);
      setTimeout(() => setCopiedSpec(""), 1800);
    } catch {
      setCopiedSpec("failed");
      setTimeout(() => setCopiedSpec(""), 1800);
    }
  };

  // 本地解析上传的 docx/pdf，直接填进条款（服务端不调用任何 LLM）
  const importDocument = async (file) => {
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const data = btoa(bin);
      const r = await fetch("/api/manager/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, data }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "解析失败");
      setForm((f) => ({ ...f, title: j.title || f.title }));
      setIntro(j.intro || "");
      setSections((j.sections || []).map((x) => ({ heading: x.heading, body: x.body })));
      setPreview(false);
      // AI 导出标记里带 partyA/partyB 的话，按名字自动匹配当事人
      const matchParty = (name) => {
        const key = String(name || "").trim().toLowerCase();
        if (!key) return "";
        const hit = (parties || []).find((x) =>
          String(x.name || "").trim().toLowerCase() === key ||
          String(x.nameEn || "").trim().toLowerCase() === key);
        return hit ? hit.id : "";
      };
      const pa = matchParty(j.meta && j.meta.partya);
      const pb = matchParty(j.meta && j.meta.partyb);
      if (pa || pb) setForm((f) => ({ ...f, partyA: pa || f.partyA, partyB: pb || f.partyB }));
      // 标记里写了当事人但系统里没有 → 明确告诉用户，别让两个下拉静默空着
      const wanted = { 甲方: (j.meta && j.meta.partya) || "", 乙方: (j.meta && j.meta.partyb) || "" };
      const unmatched = Object.entries(wanted)
        .filter(([, name]) => name && !matchParty(name))
        .map(([side, name]) => ({ side, name }));
      setImportMsg({
        ok: true, warnings: j.warnings || [], stats: j.stats, marked: j.marked,
        meta: j.meta || {}, checks: j.checks || null, content: j.content || null, unmatched,
      });
    } catch (e) {
      setImportMsg({ ok: false, error: String(e.message || e) });
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  };



  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: p.name + (p.nameEn ? " / " + p.nameEn : "") })),
    [parties],
  );

  // 分段编辑：前言 + 条款；拼回 Markdown 存进 form.body，保持指纹/PDF/大模型逻辑不变。
  useEffect(() => {
    setForm((f) => {
      const body = composeContract({ intro, sections });
      return body === f.body ? f : { ...f, body };
    });
  }, [intro, sections]);

  const addSection = () => setSections((list) => [...list, { heading: "", body: "" }]);
  const updateSection = (i, patch) => setSections((list) => list.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  // 在正文光标处插入片段（没有光标就追加到末尾）
  const insertIntoBody = (i, snippet) => {
    const ta = bodyRefs.current[i];
    const body = sections[i] ? sections[i].body : "";
    const pos = ta && typeof ta.selectionStart === "number" ? ta.selectionStart : body.length;
    const before = body.slice(0, pos);
    const after = body.slice(pos);
    const lead = before ? (/\n\s*$/.test(before) ? "\n" : "\n\n") : "";
    const tail = after ? "\n\n" : "";
    updateSection(i, { body: before + lead + snippet + tail + after });
  };

  const insertTable = () => {
    if (!tbl) return;
    const md = String(tbl.text || "").trim()
      ? tableFromText(tbl.text)
      : emptyTable(tbl.rows, tbl.cols, tbl.header !== false);
    if (md) insertIntoBody(tbl.index, md);
    setTbl(null);
  };
  const removeSection = (i) => setSections((list) => list.filter((_, k) => k !== i));
  const moveSection = (i, dir) => setSections((list) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const applyTemplate = (id) => {
    const tpl = templateById(id);
    if (!tpl) return;
    if (!intro.trim()) setIntro(tpl.intro);
    setSections((list) => [...list, ...tpl.sections.map((x) => ({ ...x }))]);
  };

  // Read the value before the updater runs: React batches updates, and the
  // controlled re-render resets e.target by the time the callback executes.
  useEffect(() => {
    if (!renewSeed) return;
    const parsed = parseContract(renewSeed.body || "");
    setIntro(parsed.intro);
    setSections(parsed.sections);
    setForm({
      title: renewSeed.title || "",
      body: renewSeed.body || "",
      consentText: renewSeed.consentText || "",
      expiresAt: "",
      expiryPreset: "none",
      partyA: renewSeed.partyA || "",
      partyB: renewSeed.partyB || "",
      send: false,
    });
    setOpen(true);
    if (onRenewConsumed) onRenewConsumed();
  }, [renewSeed, onRenewConsumed]);

  const set = (k) => (e) => {
    const el = e.target;
    const value = el.type === "checkbox" ? el.checked : el.value;
    if (k === "body") setAckPlaceholders(false);
    if (k === "body") setAckError(false);
    setForm((f) => ({ ...f, [k]: value }));
  };

  // Signing deadline: short, capped at 30 days by the service.
  const computedSignDeadline = () => {
    const raw = Number(form.signPreset || 14);
    const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 30) : 14;
    return new Date(Date.now() + days * 86400000).toISOString();
  };
  // Contract term: months from the effective date, or an explicit date.
  const computedTerm = () => {
    const p = form.termPreset || "none";
    if (p === "custom") return { termMonths: null, termEnd: form.expiresAt || null };
    const m = Number(p);
    return { termMonths: Number.isFinite(m) && m > 0 ? m : null, termEnd: null };
  };

  const submit = async (e) => {
    e.preventDefault();
    await createWith(false);
  };

  const createWith = async (shouldSend) => {
    setErr(""); setBusy("create"); setCreated(null);
    const a = parties.find((p) => p.id === form.partyA);
    const b = parties.find((p) => p.id === form.partyB);
    if (!a || !b) { setErr(t({ en: "Pick both parties.", cn: "请选择双方主体。" })); setBusy(""); return; }
    try {
      const r = await fetch("/api/manager/agreements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title, body: form.body, consentText: form.consentText,
          signDeadline: computedSignDeadline(),
          termMonths: computedTerm().termMonths,
          termEnd: computedTerm().termEnd || undefined,
          send: shouldSend,
          partyA: { contactId: a.id },
          partyB: { contactId: b.id },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.status);
      setCreated(j);
      setForm({ title: "", body: "", consentText: DEFAULT_CONSENT, expiresAt: "", partyA: "", partyB: "", send: false });
      setIntro("");
      setSections([]);
      if (onCreated) onCreated(j.id);
    } catch (e2) {
      setErr(String(e2.message || e2));
    } finally { setBusy(""); }
  };

  const exportCsv = () => {
    const head = ["编号", "标题", "状态", "创建", "发出", "完成", "到期", "已签/总数"];
    const cell = (v) => {
      const text = v == null ? "" : String(v);
      return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    const lines = [head.join(",")].concat(filtered.map((a) => [
      a.number || "", a.title || "", a.status || "",
      a.createdAt || "", a.sentAt || "", a.completedAt || "",
      a.termEnd || a.signDeadline || a.expiresAt || "",
      `${a.signed ?? 0}/${a.total ?? ""}`,
    ].map(cell).join(",")));
    // BOM：让 Excel 正确识别 UTF-8
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `agreements-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="aw-list-wrap">

      {open ? (
        <div className="aw-form-modal" onClick={() => setOpen(false)}>
        <form className="aw-form-panel" ref={formRef} role="dialog" aria-modal="true" aria-label={t({ en: "New agreement", cn: "新建协议" })} tabIndex={-1} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
          <div className="aw-form-head">
            <div>
              <div className="ag-mono">{t({ en: "New agreement", cn: "新建协议" })}</div>
              <div className="aw-form-title">{t({ en: "Draft the contract", cn: "起草合同" })}</div>
            </div>
            <span className="aw-form-actions" style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <input
                ref={importRef}
                type="file"
                accept=".docx,.pdf,.md,.txt"
                style={{ display: "none" }}
                onChange={(e) => importDocument(e.target.files && e.target.files[0])}
              />
              <button type="button" className="aw-text-btn" onClick={() => setSpecOpen(true)}>
                {t({ en: "AI export spec", cn: "AI 导出规范" })}
              </button>
              <button type="button" className="aw-text-btn" disabled={importing} onClick={() => importRef.current && importRef.current.click()}>
                {importing ? t({ en: "Reading…", cn: "解析中…" }) : t({ en: "Import Word / PDF", cn: "导入 Word / PDF" })}
              </button>
              <button type="button" className="aw-text-btn" onClick={() => setOpen(false)}>{t({ en: "Cancel", cn: "取消" })}</button>
            </span>
          </div>
          {importMsg ? (
            <div style={{ margin: "0 30px 4px", padding: "10px 12px", border: "1px solid " + (importMsg.ok ? "#d8e6c9" : "#f0c9c9"), background: importMsg.ok ? "#f6faf1" : "#fff5f5", borderRadius: 6, fontSize: 12.5 }}>
              {importMsg.ok ? (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontWeight: 600 }}>{t({ en: "Imported", cn: "已导入" })}</strong>
                    <span>
                      {importMsg.checks
                        ? [
                            `${importMsg.checks.chapters} ${t({ en: "chapters", cn: "章" })}`,
                            importMsg.checks.subsections ? `${importMsg.checks.subsections} ${t({ en: "sub-clauses", cn: "子条款" })}` : null,
                            importMsg.checks.tables ? `${importMsg.checks.tables} ${t({ en: "table rows", cn: "表格行" })}` : null,
                          ].filter(Boolean).join(" · ")
                        : `${importMsg.stats?.sections || 0} ${t({ en: "clauses", cn: "条" })}`}
                      {" · "}
                      {importMsg.stats?.chars || 0} {t({ en: "chars", cn: "字" })}
                    </span>
                    {importMsg.marked ? (
                      <span style={{ padding: "1px 6px", border: "1px solid #b9d3a5", borderRadius: 4, background: "#eef7e6", fontSize: 11 }}>
                        {t({ en: "AI marker", cn: "AI 标记" })} v{AI_SPEC_VERSION}
                      </span>
                    ) : null}
                  </div>
                  {/* 导入即自检：编号 / 交叉引用 / 签署表 / 占位符 / 空章节 / 重复标题 */}
                  {importMsg.checks?.checks?.length ? (
                    <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 3 }}>
                      {importMsg.checks.checks.map((c) => (
                        <li key={c.code} style={{ display: "flex", gap: 7, alignItems: "baseline", color: "#8a5a10" }}>
                          <span aria-hidden="true" style={{ flex: "0 0 auto", fontWeight: 700 }}>!</span>
                          <span>{c.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ marginTop: 6, color: "#4c7a34" }}>
                      {t({ en: "Self-check passed: numbering, cross-references, signature tables all clean.", cn: "自检通过：编号、交叉引用、签署表都没有问题。" })}
                    </div>
                  )}
                  {importMsg.content && (importMsg.content.missing || []).length ? (
                    <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed #d9c9a6", color: "#8a5a10" }}>
                      <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
                        <span aria-hidden="true" style={{ flex: "0 0 auto", fontWeight: 700 }}>!</span>
                        <span>
                          {t({ en: "Content check", cn: "内容体检" })}
                          {" · "}
                          {t({ en: "missing", cn: "缺少" })}
                          {" "}
                          {importMsg.content.missing.length}
                          {t({ en: " of ", cn: " / " })}
                          {importMsg.content.total}
                        </span>
                      </div>
                      <ul style={{ margin: "4px 0 0 18px", padding: 0, display: "grid", gap: 2 }}>
                        {importMsg.content.missing.slice(0, 3).map((m) => (
                          <li key={m.code} style={{ fontSize: 12 }}><strong style={{ fontWeight: 600 }}>{m.label}</strong>：{m.hint}</li>
                        ))}
                      </ul>
                      {importMsg.content.missing.length > 3 ? (
                        <div style={{ margin: "3px 0 0 18px", fontSize: 11.5, color: "#8a6a2a" }}>
                          {t({ en: `+${importMsg.content.missing.length - 3} more`, cn: `另有 ${importMsg.content.missing.length - 3} 项` })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {importMsg.unmatched?.length ? (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", color: "#8a5a10" }}>
                      <span aria-hidden="true" style={{ fontWeight: 700 }}>!</span>
                      <span>
                        {t({ en: "Not found in parties:", cn: "当事人里没有：" })}
                        {" "}
                        {importMsg.unmatched.map((u) => `${u.side} ${u.name}`).join(" / ")}
                      </span>
                      <button
                        type="button"
                        className="aw-text-btn"
                        style={{ textDecoration: "underline" }}
                        onClick={() => { setOpen(false); onGotoParties && onGotoParties(); }}
                      >
                        {t({ en: "Create them", cn: "去新建" })}
                      </button>
                    </div>
                  ) : null}
                  {importMsg.warnings?.length ? (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#666" }}>
                      {importMsg.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  ) : null}
                </>
              ) : (
                <div>{t({ en: "Import failed", cn: "导入失败" })}：{importMsg.error}</div>
              )}
            </div>
          ) : null}
          <div className="aw-form-body">
          <div className="ag-field">
            <span className="aw-label">{t({ en: "Title", cn: "标题" })}</span>
            <input className="ag-input" value={form.title} onChange={set("title")} required maxLength={200} placeholder={t({ en: "e.g. Software development agreement (phase 2)", cn: "例如：软件开发合同（二期）" })} />
          </div>
          <div className="ag-form-grid2">
            <div className="ag-field">
              <span className="aw-label">{t({ en: "Party A", cn: "甲方" })}</span>
              <AwSelect
                value={form.partyA}
                onChange={(v) => setForm((f) => ({ ...f, partyA: v }))}
                ariaLabel={t({ en: "Party A", cn: "甲方" })}
                options={[{ value: "", label: "—" }, ...partyOptions]}
              />
            </div>
            <div className="ag-field">
              <span className="aw-label">{t({ en: "Party B", cn: "乙方" })}</span>
              <AwSelect
                value={form.partyB}
                onChange={(v) => setForm((f) => ({ ...f, partyB: v }))}
                ariaLabel={t({ en: "Party B", cn: "乙方" })}
                options={[{ value: "", label: "—" }, ...partyOptions]}
              />
            </div>
          </div>
          <div className="ag-field">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <span className="aw-label">{t({ en: "Contract clauses", cn: "合同条款（分段）" })}</span>
              <span style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
                <span className="aw-label" style={{ opacity: 0.55 }}>{form.body.length} 字</span>
                <button type="button" className="aw-text-btn" onClick={() => setPreview((v) => !v)}>
                  {preview ? t({ en: "Edit", cn: "继续编辑" }) : t({ en: "Preview", cn: "预览" })}
                </button>
              </span>
            </div>
            {preview ? (
              <div className="ag-textarea ag-contract-preview" style={{ padding: "18px 20px", height: 420, overflow: "auto" }}>
                {form.body.trim() ? (
                  <div className="ag-prose ag-contract" style={{ margin: 0 }}>
                    <MarkdownBody markdown={form.body} title={form.title} />
                  </div>
                ) : (
                  <span className="ag-sub">{t({ en: "Nothing to preview yet.", cn: "还没有正文可预览。" })}</span>
                )}
              </div>
            ) : (
              <div className="ag-sections">
                <textarea
                  className="ag-textarea ag-intro"
                  rows={2}
                  placeholder={t({ en: "Preamble (optional)", cn: "前言（可选）：例如“甲乙双方经友好协商，达成如下条款。”" })}
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                />

                {sections.map((sec, i) => {
                  const headingIndex = sections.slice(0, i).filter((x) => x.heading.trim()).length;
                  const numIssue = numberIssues.find((x) => x.index === i);
                  const hasSigTable = findSignatureTables(sec.body).length > 0;
                  const refIssue = refIssues.find((x) => x.index === i);
                  return (
                    <div className="ag-sec" key={i}>
                      <div className="ag-sec-head">
                        <span className="ag-mono ag-sec-num">{sec.heading.trim() ? `第${toChinese(headingIndex + 1)}条` : `第 ${i + 1} 段`}</span>
                        <input
                          className="ag-sec-title"
                          value={sec.heading}
                          maxLength={80}
                          placeholder={t({ en: "Clause title", cn: "条款标题，如：服务内容" })}
                          onChange={(e) => updateSection(i, { heading: e.target.value.replace(/^第[一二三四五六七八九十百零〇\d]+条\s*/, "") })}
                        />
                        <span className="ag-sec-actions">
                          <button type="button" className="aw-text-btn" onClick={() => insertIntoBody(i, "### 子条款标题\n\n内容…")}>＋子条款</button>
                          <button type="button" className="aw-text-btn" onClick={() => insertIntoBody(i, "- 第一点\n- 第二点")}>＋列表</button>
                          <button type="button" className="aw-text-btn" onClick={() => setTbl({ index: i, text: "", rows: 4, cols: 3, header: true })}>＋表格</button>
                          <button type="button" className="aw-text-btn" onClick={() => moveSection(i, -1)} disabled={i === 0}>上移</button>
                          <button type="button" className="aw-text-btn" onClick={() => moveSection(i, 1)} disabled={i === sections.length - 1}>下移</button>
                          <button type="button" className="aw-text-btn" onClick={() => removeSection(i)}>删除</button>
                        </span>
                      </div>
                      <textarea
                        className="ag-textarea ag-sec-body"
                        ref={(el) => { bodyRefs.current[i] = el; }}
                        rows={3}
                        placeholder={t({ en: "Clause text (Markdown)", cn: "条款正文（可用列表、加粗）" })}
                        value={sec.body}
                        onChange={(e) => updateSection(i, { body: e.target.value })}
                      />
                      {refIssue ? (
                        <p className="ag-sub" style={{ fontSize: 11.5, margin: "4px 0 0", color: "#8a6a12" }}>
                          {t({
                            en: `Cross-reference not found: ${refIssue.missing.map((n) => "第" + n + "条").join("、")} — the clause was renamed or removed.`,
                            cn: `引用的条款不存在：${refIssue.missing.map((n) => "第" + n + "条").join("、")}——可能是条款改名或删除了。`,
                          })}
                        </p>
                      ) : null}
                      {hasSigTable ? (
                        <p className="ag-sub" style={{ fontSize: 11.5, margin: "4px 0 0", color: "#8a6a12" }}>
                          {t({
                            en: "This clause still has a signature table. The agreement adds its own signing block — remove it to avoid duplicates.",
                            cn: "本段里有「签署表」（签字/日期）。电子协议会自动生成签署栏，建议移除，避免重复。",
                          })}{" "}
                          <button
                            type="button"
                            className="aw-text-btn"
                            onClick={() => updateSection(i, { body: stripSignatureTables(sec.body) })}
                          >
                            {t({ en: "Remove it", cn: "移除签署表" })}
                          </button>
                        </p>
                      ) : null}
                      {numIssue ? (
                        <p className="ag-sub" style={{ fontSize: 11.5, margin: "4px 0 0", color: "#8a6a12" }}>
                          {t({
                            en: `Hand-written clause number "${numIssue.sample}" does not match 第${numIssue.chapter}条. Use "＋子条款" (### heading) so numbering stays automatic.`,
                            cn: `正文里手写的「${numIssue.sample}」与当前「第${numIssue.chapter}条」不一致；建议改用「＋子条款」（### 子标题），编号会自动跟随。`,
                          })}
                        </p>
                      ) : null}
                    </div>
                  );
                })}

                <div className="ag-sec-tools">
                  <button type="button" className="aw-text-btn" onClick={addSection}>＋ 添加条款</button>
                  <AwSelect
                    value=""
                    onChange={(v) => applyTemplate(v)}
                    ariaLabel={t({ en: "Apply clause template", cn: "套用条款模板" })}
                    placeholder={t({ en: "Apply clause template…", cn: "套用条款模板…" })}
                    options={CONTRACT_TEMPLATES.map((tpl) => ({ value: tpl.id, label: tpl.name }))}
                  />
                </div>
              </div>
            )}
            {placeholders.length ? (
              <div style={{ marginTop: 10, padding: "10px 12px", border: "1px solid #f0d9a8", background: "#fff8e6", borderRadius: 8 }}>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  {t({ en: "Possible unfilled placeholders:", cn: "检测到未填写占位符：" })}
                  {" "}{placeholders.length} 处 · {describePlaceholders(placeholders)}
                </div>
                <div className="aw-label" style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
                  {placeholders.slice(0, 2).map((p) => p.sample).join(" ｜ ")}
                </div>
              </div>
            ) : null}
          </div>
          <div className="ag-field">
            <span className="aw-label">{t({ en: "Consent text", cn: "同意条款" })}</span>
            <input className="ag-input" value={form.consentText} onChange={set("consentText")} maxLength={500} />
          </div>
          <div className="ag-form-grid2">
                        <div className="ag-field">
              <span className="aw-label">{t({ en: "Sign by", cn: "签署截止" })}</span>
              <AwSelect
                value={form.signPreset}
                onChange={(v) => setForm((f) => ({ ...f, signPreset: v }))}
                ariaLabel={t({ en: "Sign by", cn: "签署截止" })}
                options={[
                  { value: "7", label: t({ en: "7 days", cn: "7 天" }) },
                  { value: "14", label: t({ en: "14 days", cn: "14 天" }) },
                  { value: "30", label: t({ en: "30 days", cn: "30 天" }) },
                ]}
              />
              <span className="aw-label" style={{ marginTop: 10 }}>{t({ en: "Contract term", cn: "合同期限" })}</span>
              <AwSelect
                value={form.termPreset}
                onChange={(v) => setForm((f) => ({ ...f, termPreset: v }))}
                ariaLabel={t({ en: "Contract term", cn: "合同期限" })}
                options={[
                  { value: "none", label: t({ en: "No term", cn: "不设期限" }) },
                  { value: "12", label: t({ en: "1 year", cn: "1 年" }) },
                  { value: "24", label: t({ en: "2 years", cn: "2 年" }) },
                  { value: "36", label: t({ en: "3 years", cn: "3 年" }) },
                  { value: "custom", label: t({ en: "Custom end date", cn: "自定义到期日" }) },
                ]}
              />
              {form.termPreset === "custom" ? (
                <input className="ag-input" type="datetime-local" value={form.expiresAt} onChange={set("expiresAt")} style={{ marginTop: 8 }} />
              ) : null}
            </div>
            <div className="ag-field">
              <span className="aw-label">{t({ en: "After creating", cn: "创建后" })}</span>
              <span className="ag-sub" style={{ fontSize: 12 }}>{t({ en: "Saved as a draft. Send it from the agreement's page when it's ready.", cn: "先存为草稿；确认无误后，在协议详情页发送。" })}</span>
            </div>
          </div>
          {err ? <p className="ag-alert">{err}</p> : null}
          {created ? (
            <p className="ag-sub">
              {t({ en: "Created", cn: "已创建" })}: {created.number || created.id}
              {created.links?.length ? " · " + created.links.length + " " + t({ en: "links", cn: "条链接" }) : ""}
            </p>
          ) : null}
          </div>
          <div className="aw-form-foot">
            <button className="ag-btn ag-btn--primary" type="button" data-intent="draft" onClick={() => createWith(false)} disabled={busy === "create"}>
              {busy === "create" ? t({ en: "Saving…", cn: "保存中…" }) : t({ en: "Create", cn: "创建" })}
            </button>
          </div>
        </form>

        {tbl ? (
          <div className="aw-tbl-dialog" onClick={() => setTbl(null)}>
            <div
              className="aw-tbl-panel"
              role="dialog"
              aria-modal="true"
              aria-label={t({ en: "Insert table", cn: "插入表格" })}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="aw-label">{t({ en: "Insert table", cn: "插入表格" })}</div>
              <p className="ag-sub" style={{ fontSize: 12, margin: "6px 0 10px" }}>
                {t({
                  en: "Paste a range copied from Excel (tab separated), or generate an empty grid. First row becomes the header.",
                  cn: "从 Excel 复制的区域直接粘贴（制表符分隔），或按行列生成空表。第一行作为表头。",
                })}
              </p>
              <textarea
                className="ag-textarea"
                rows={6}
                value={tbl.text}
                placeholder={"字段\t说明\t示例\nartist\t艺术家姓名\tZhou Song"}
                onChange={(e) => setTbl({ ...tbl, text: e.target.value })}
              />
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <span className="ag-sub" style={{ fontSize: 12 }}>{t({ en: "or", cn: "或" })}</span>
                <input className="ag-input" style={{ width: 64 }} type="number" min={2} max={12} value={tbl.cols}
                  onChange={(e) => setTbl({ ...tbl, cols: e.target.value })} aria-label="columns" />
                <span className="ag-sub" style={{ fontSize: 12 }}>{t({ en: "columns", cn: "列" })}</span>
                <input className="ag-input" style={{ width: 64 }} type="number" min={2} max={40} value={tbl.rows}
                  onChange={(e) => setTbl({ ...tbl, rows: e.target.value })} aria-label="rows" />
                <span className="ag-sub" style={{ fontSize: 12 }}>{t({ en: "rows", cn: "行" })}</span>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginLeft: 8 }}>
                  <input type="checkbox" checked={tbl.header !== false}
                    onChange={(e) => setTbl({ ...tbl, header: e.target.checked })} />
                  {t({ en: "First row is a header", cn: "首行作为表头" })}
                </label>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 16, marginTop: 16 }}>
                <button type="button" className="aw-text-btn" onClick={() => setTbl(null)}>{t({ en: "Cancel", cn: "取消" })}</button>
                <button type="button" className="ag-btn ag-btn--primary ag-btn--small" onClick={insertTable}>{t({ en: "Insert", cn: "插入" })}</button>
              </div>
            </div>
          </div>
        ) : null}

        {specOpen ? (
          <div className="aw-tbl-dialog" onClick={() => setSpecOpen(false)}>
            <div className="aw-tbl-panel aw-tbl-panel--spec" role="dialog" aria-modal="true" aria-label="AI export spec" onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 100%)", display: "flex", flexDirection: "column", gap: 10, maxHeight: "calc(100dvh - 32px)", overflowY: "auto" }}>
              <div className="aw-label">{t({ en: "AI export spec · v" + AI_SPEC_VERSION, cn: "AI 导出规范 v" + AI_SPEC_VERSION })}</div>
              <p className="ag-sub" style={{ fontSize: 12, margin: "6px 0 10px" }}>
                {t({
                  en: "Give this to your AI model. It writes a small front-matter block (the marker this app recognises) and a body this importer can split into clauses without guessing.",
                  cn: "把下面这段交给 AI 模型。它会在文件开头写一小段 front matter（本应用识别的对版标记），并按可解析的结构写正文，导入时不用再猜标题和层级。",
                })}
              </p>
              <pre
                style={{
                  margin: 0, flex: "1 1 auto", maxHeight: "46dvh", overflow: "auto",
                  background: "#fafaf8", border: "1px solid #ecece7", borderRadius: 6,
                  padding: "12px 14px 22px", fontSize: 12, lineHeight: 1.6,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  // 底部淡出，提示还有内容可以滚
                  maskImage: "linear-gradient(to bottom, #000 88%, transparent 100%)",
                  WebkitMaskImage: "linear-gradient(to bottom, #000 88%, transparent 100%)",
                }}
              >
                {AI_EXPORT_PROMPT}
              </pre>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={"aw-iconbtn" + (copiedSpec === "prompt" ? " aw-iconbtn--done" : "")}
                  title={t({ en: "Copy instructions", cn: "复制指令" })}
                  aria-label={t({ en: "Copy instructions", cn: "复制指令" })}
                  onClick={() => copyText(AI_EXPORT_PROMPT, "prompt")}
                >
                  {copiedSpec === "prompt" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="1.5" /><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" /></svg>
                  )}
                </button>
                <button
                  type="button"
                  className={"aw-iconbtn" + (copiedSpec === "tpl" ? " aw-iconbtn--done" : "")}
                  title={t({ en: "Copy blank template", cn: "复制空白模板" })}
                  aria-label={t({ en: "Copy blank template", cn: "复制空白模板" })}
                  onClick={() => copyText(AI_EMPTY_TEMPLATE, "tpl")}
                >
                  {copiedSpec === "tpl" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>
                  )}
                </button>
                <a className="ag-sub" href="/ai-spec" target="_blank" rel="noreferrer" style={{ fontSize: 11.5, marginLeft: "auto", textDecoration: "underline" }}>
                  {t({ en: "Open as page ↗", cn: "打开公开页 ↗" })}
                </a>
                <span className="ag-sub" style={{ fontSize: 11.5 }}>
                  {copiedSpec === "prompt"
                    ? t({ en: "Instructions copied", cn: "指令已复制" })
                    : copiedSpec === "tpl"
                      ? t({ en: "Template copied", cn: "模板已复制" })
                      : copiedSpec === "failed"
                        ? t({ en: "Copy failed — select the text manually", cn: "复制失败，请手动选中文本" })
                        : t({ en: "Copy instructions / blank template · .md · .docx · text-based .pdf", cn: "复制指令 / 空白模板 · 支持 .md · .docx · 文本型 .pdf" })}
                </span>
              </div>
            </div>
          </div>
        ) : null}
        </div>
      ) : null}

      <div className="aw-list-head">
        <h1 className="aw-page-title">{t({ en: "Agreements", cn: "协议" })}</h1>
        <div className="aw-list-actions">
          <button
            type="button"
            className="aw-ghost-btn"
            onClick={exportCsv}
            title={t({ en: "Export CSV (current filter)", cn: "导出 CSV（当前筛选结果）" })}
          >{t({ en: "Export CSV", cn: "导出 CSV" })}</button>
          <button type="button" className="aw-new-btn" onClick={() => setOpen(true)}>
            {t({ en: "New agreement", cn: "新建协议" })}
          </button>
        </div>
      </div>

      <div className="aw-search-row">
        <input
          className="aw-search aw-search--wide"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder={t({ en: "Search number or title", cn: "搜索编号或标题" })}
          aria-label={t({ en: "Search agreements", cn: "搜索协议" })}
        />
      </div>

      {filtered.length === 0 && rows.length === 0 ? (
        <div className="aw-empty">
          <div className="aw-empty-title">{justCleared ? t({ en: "Sample data cleared", cn: "示例数据已清空" }) : t({ en: "No agreements yet", cn: "还没有协议" })}</div>
          <p className="ag-sub">{justCleared
            ? t({ en: "Start by drafting a real contract.", cn: "从新建第一份正式合同开始；需要示例数据可重新导入 data/csv。" })
            : t({ en: "Create the first contract, or import the sample CSV data.", cn: "创建第一份合同，或先导入 data/csv 的案例数据。" })}</p>
          <button className="ag-btn ag-btn--primary" type="button" onClick={() => setOpen(true)}>{t({ en: "New agreement", cn: "新建协议" })}</button>
        </div>
      ) : filtered.length === 0 ? <p className="ag-sub" style={{ marginTop: 18 }}>{t({ en: "No agreements match this filter.", cn: "没有符合筛选条件的协议。" })}</p> : (
        <table className="ag-table aw-table--agreements" style={{ marginTop: 18 }}>
          <thead>
            <tr>
              <th>{t({ en: "Number", cn: "编号" })}</th>
              <th>{t({ en: "Title", cn: "标题" })}</th>
              <th>{t({ en: "Status", cn: "状态" })}</th>
              <th>{t({ en: "Created", cn: "创建" })}</th>
              <th>{t({ en: "Expires", cn: "到期" })}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {view.map((a) => (
              <tr
                key={a.id}
                className="aw-row-ag aw-hover-row aw-row-click"
                onClick={() => onCreated(a.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCreated(a.id); }
                }}
                tabIndex={0}
                role="link"
                aria-label={(a.number || "") + " " + (a.title || "")}
              >
                <td className="aw-c-num ag-mono">{a.number || "—"}</td>
                <td className="aw-c-title">{a.title || "—"}</td>
                <td className="aw-c-state">
                  <span className={"aw-dot aw-dot--" + String(a.status || "").toLowerCase()} aria-hidden="true" />
                  {{
                    DRAFT: t({ en: "Draft", cn: "草稿" }),
                    SENT: t({ en: "Sent", cn: "已发送" }),
                    COMPLETED: t({ en: "Completed", cn: "已完成" }),
                    DECLINED: t({ en: "Declined", cn: "已拒绝" }),
                    VOIDED: t({ en: "Voided", cn: "已作废" }),
                  }[a.status] || a.status}
                </td>
                <td className="aw-c-created ag-mono">{fmt(a.createdAt)}</td>
                <td
                  className="aw-c-expires ag-mono"
                  title={t({
                    en: "Expiry date · VALID = still in force, SOON = expiring within 7 days, EXPIRED = past the date",
                    cn: "到期时间 · 有效 = 仍在期限内，即将到期 = 7 天内到期，已到期 = 已过期",
                  })}
                >{(() => {
                  const done = a.status === "COMPLETED";
                  const iso = done ? a.termEnd : (a.signDeadline || a.expiresAt);
                  if (!iso) return "—";
                  const s = done
                    ? termState({ status: a.status, termEnd: a.termEnd, renewalStatus: a.renewalStatus, renewalDeadline: a.renewalDeadline })
                    : expiryState(iso);
                  const text = s.state === "renewed"
                    ? t({ en: "renewed", cn: "已续签" })
                    : s.state === "renewal-expired" ? t({ en: "renewal expired", cn: "续签已过期" })
                    : s.state === "expired" ? t({ en: "expired", cn: "已到期" })
                    : s.state === "soon" ? t({ en: "soon", cn: "即将到期" })
                    : t({ en: "valid", cn: "有效" });
                  return fmt(iso) + " · " + text;
                })()}</td>
                <td className="aw-c-open">
                  <button className="aw-open-btn" onClick={() => onCreated(a.id)}>
                    {t({ en: "Open", cn: "打开" })} <span aria-hidden="true">→</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {filtered.length > PAGE ? (
        <div className="aw-pager2">
          <span className="ag-mono">{(current - 1) * PAGE + 1}–{Math.min(current * PAGE, filtered.length)} / {filtered.length}</span>
          <span className="aw-pager2-actions">
            <button className="aw-text-btn" disabled={current <= 1} onClick={() => setPage(current - 1)}>上一页</button>
            <button className="aw-text-btn" disabled={current >= pages} onClick={() => setPage(current + 1)}>下一页</button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ─── Parties tab ───────────────────────────────────────────────────────────
function PartiesTab({ t, cn, rows, onCreated }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const partyRef = useModalA11y(open, () => setOpen(false));
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((p) => [p.name, p.nameEn, p.email, p.contactPerson].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)));
  }, [rows, q]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ kind: "company", name: "", nameEn: "", contactPerson: "", email: "", phone: "", address: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/manager/party-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.status);
      setForm({ kind: "company", name: "", nameEn: "", contactPerson: "", email: "", phone: "", address: "" });
      if (onCreated) onCreated();
    } catch (e2) { setErr(String(e2.message || e2)); } finally { setBusy(false); }
  };

  const archive = async (id) => {
    const r = await fetch(`/api/manager/party-info/${id}`, { method: "DELETE" });
    if (r.ok && onCreated) onCreated();
  };

  return (
    <div className="aw-list-wrap">
      <div className="aw-list-head">
        <h1 className="aw-page-title">{t({ en: "Parties", cn: "主体" })}</h1>
        <div className="aw-list-actions">
          <button type="button" className="aw-new-btn" onClick={() => setOpen(true)}>
            {t({ en: "New party", cn: "新建主体" })}
          </button>
        </div>
      </div>

      <div className="aw-search-row">
        <input
          className="aw-search aw-search--wide"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t({ en: "Search name, email, contact", cn: "搜索名称、邮箱或联系人" })}
          aria-label={t({ en: "Search parties", cn: "搜索主体" })}
        />
      </div>

      {open ? (
        <div className="aw-form-modal" onClick={() => setOpen(false)}>
        <form className="aw-form-panel aw-form-panel--sm" ref={partyRef} role="dialog" aria-modal="true" aria-label={t({ en: "New party", cn: "新建主体" })} tabIndex={-1} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
          <div className="aw-form-head">
            <div>
              <div className="ag-mono">{t({ en: "New party", cn: "新建主体" })}</div>
              <div className="aw-form-title">{t({ en: "Add a counterparty", cn: "添加签约主体" })}</div>
            </div>
          </div>
          <div className="aw-form-body">
          <div className="ag-form-grid2">
            <div className="ag-field">
              <span className="aw-label">{t({ en: "Kind", cn: "类型" })}</span>
              <AwSelect
                value={form.kind}
                onChange={(v) => setForm((f) => ({ ...f, kind: v }))}
                ariaLabel={t({ en: "Kind", cn: "类型" })}
                options={[
                  { value: "company", label: t({ en: "Company", cn: "公司" }) },
                  { value: "person", label: t({ en: "Person", cn: "个人" }) },
                ]}
              />
            </div>
            <div className="ag-field">
              <span className="aw-label">{t({ en: "Name", cn: "名称" })}</span>
              <input className="ag-input" value={form.name} onChange={set("name")} required maxLength={120} />
            </div>
            <div className="ag-field">
              <span className="aw-label">{t({ en: "Name (EN)", cn: "英文名" })}</span>
              <input className="ag-input" value={form.nameEn} onChange={set("nameEn")} maxLength={120} />
            </div>
            <div className="ag-field">
              <span className="aw-label">{t({ en: "Contact", cn: "联系人" })}</span>
              <input className="ag-input" value={form.contactPerson} onChange={set("contactPerson")} maxLength={80} />
            </div>
            <div className="ag-field">
              <span className="aw-label">Email</span>
              <input className="ag-input" type="email" value={form.email} onChange={set("email")} maxLength={160} />
            </div>
            <div className="ag-field">
              <span className="aw-label">{t({ en: "Phone", cn: "电话" })}</span>
              <input className="ag-input" value={form.phone} onChange={set("phone")} maxLength={40} />
            </div>
          </div>
          <div className="ag-field">
            <span className="aw-label">{t({ en: "Address", cn: "地址" })}</span>
            <input className="ag-input" value={form.address} onChange={set("address")} maxLength={200} />
          </div>
          {err ? <p className="ag-alert">{err}</p> : null}
          </div>
          <div className="aw-form-foot">
            <button className="ag-btn ag-btn--ghost" type="button" onClick={() => setOpen(false)}>{t({ en: "Cancel", cn: "取消" })}</button>
            <button className="ag-btn ag-btn--primary" type="submit" disabled={busy}>
              {busy ? t({ en: "Saving…", cn: "保存中…" }) : t({ en: "Create", cn: "创建" })}
            </button>
          </div>
        </form>
        </div>
      ) : null}

      {filtered.length === 0 ? <p className="ag-sub" style={{ marginTop: 18 }}>{t({ en: "No parties match this search.", cn: "没有符合条件的主体。" })}</p> : (
        <table className="ag-table aw-table--parties" style={{ marginTop: 18 }}>
          <thead><tr><th>{t({ en: "Name", cn: "名称" })}</th><th>{t({ en: "Kind", cn: "类型" })}</th><th>Email</th><th>{t({ en: "Phone", cn: "电话" })}</th><th /></tr></thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="aw-hover-row">
                <td>{names(p)}</td>
                <td>{p.kind || "—"}</td>
                <td>{p.email || "—"}</td>
                <td className="ag-mono">{p.phone || "—"}</td>
                <td><button className="ag-btn ag-btn--small ag-btn--ghost" onClick={() => archive(p.id)}>{t({ en: "Archive", cn: "归档" })}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
