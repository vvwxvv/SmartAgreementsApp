"use client";

import { useState } from "react";

const CN = { DRAFT: "草稿", SENT: "待签署", COMPLETED: "已完成", VOIDED: "已作废", EXPIRED: "已过期", DECLINED: "已被拒绝" };
const fmt = (d) => (d ? new Date(d).toLocaleString("zh-CN") : "—");
const ipLabel = (ip) => {
  if (!ip) return "—";
  return /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(String(ip)) ? "本机" : String(ip);
};

function chainLabel(chain) {
  if (!chain) return "—";
  if (chain.ok) return chain.complete ? `完整（${chain.count} 条事件）` : `完整（含 ${chain.legacy} 条旧记录）`;
  const why = { hash: "内容被改", link: "前后衔接断裂", fork: "出现分叉" }[chain.reason] || chain.reason;
  return `断链：${why}${Number.isInteger(chain.brokenAt) ? `（第 ${chain.brokenAt + 1} 条）` : ""}`;
}

function sigLabel(sig) {
  const status = sig?.status;
  if (status === "valid") return sig.kid ? `有效（Ed25519 ${sig.kid}）` : "有效（Ed25519）";
  if (status === "invalid") return "无效（摘要或签名被改动）";
  if (status === "unknown-key") return "无法验证（缺少对应公钥）";
  if (status === "none") return sig?.configured ? "未签名（旧记录）" : "未启用（服务端未配置密钥）";
  return "—";
}

export default function VerifyPage() {
  const [number, setNumber] = useState("");
  const [cert, setCert] = useState("");
  const [data, setData] = useState(null);
  const [sig, setSig] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function check(e) {
    e.preventDefault();
    setError("");
    setData(null);
    setSig(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/verify?number=${encodeURIComponent(number.trim())}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "查询失败");
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkCert(e) {
    e.preventDefault();
    setError("");
    setSig(null);
    setBusy(true);
    try {
      const q = `/api/verify/signature?number=${encodeURIComponent(number.trim())}&cert=${encodeURIComponent(cert.trim())}`;
      const r = await fetch(q);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "没有找到匹配的签署记录");
      setSig(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ag-root">
      <div className="ag-wrap ag-wrap--narrow" style={{ paddingTop: 48 }}>
        <div className="ag-mono">Verify</div>
        <h1 className="ag-h1" style={{ fontSize: 34 }}>查验签署记录</h1>
        <p className="ag-sub" style={{ marginTop: 12 }}>
          输入合同编号查看整体状态；再输入记录编号（PDF 附录里那串 16 位字符），可以重算该次签署的记录摘要。
        </p>

        <div className="ag-verify-card">
        <form onSubmit={check}>
          <span className="aw-label">合同编号</span>
          <div className="ag-verify-row">
          <input
            className="ag-input"
            placeholder="AGR-2026-0018"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            style={{ letterSpacing: ".06em" }}
          />
          <button className="ag-btn" style={{ whiteSpace: "nowrap" }} disabled={busy}>查验合同</button>
          </div>
        </form>

        {error ? <p className="ag-alert">{error}</p> : null}

        {data ? (
          <div style={{ marginTop: 40 }}>
            <div className="ag-mono">{data.number}</div>
            <h2 className="ag-h2" style={{ marginTop: 8 }}>{CN[data.status] || data.status}</h2>
            <div className="ag-note" style={{ marginTop: 10 }}>
              签署进度 {data.signedCount}/{data.total}
            </div>
            <div className="ag-note" style={{ marginTop: 6 }}>
              创建 {fmt(data.createdAt)} · 发出 {fmt(data.sentAt)} · 完成 {fmt(data.completedAt)}
            </div>

            <form onSubmit={checkCert} style={{ marginTop: 32 }}>
              <span className="aw-label">记录编号（PDF 附录 16 位）</span>
              <div className="ag-verify-row">
              <input
                className="ag-input"
                placeholder="如 A4D8F65D8F2CDB9D（PDF 附录第 2 页）"
                value={cert}
                onChange={(e) => setCert(e.target.value.toUpperCase())}
                style={{ letterSpacing: ".1em", fontFamily: "ui-monospace, Menlo, monospace" }}
              />
              <button className="ag-btn" style={{ whiteSpace: "nowrap" }} disabled={busy || !cert}>
                核对记录
              </button>
              </div>
            </form>

            {sig ? (
              <div className="ag-sig-verify" style={{ marginTop: 26 }}>
                <div className={sig.verified ? "ag-stamp" : "ag-alert"} style={{ display: "inline-block" }}>
                  {sig.verified
                    ? sig.legacy
                      ? "签名与证据一致（旧版摘要，覆盖有限）"
                      : "签名与证据一致"
                    : "签名与证据不一致"}
                </div>

                <div className="ag-record" style={{ marginTop: 18 }}>
                  <div><span className="ag-mono">合同</span><span>{sig.agreementNumber} · {sig.title}</span></div>
                  <div><span className="ag-mono">签署人</span><span>{sig.evidence?.signer?.label} · {sig.evidence?.signer?.email}</span></div>
                  <div><span className="ag-mono">签署时间</span><span>{fmt(sig.evidence?.signedAt)}</span></div>
                  <div><span className="ag-mono">签署 IP</span><span>{ipLabel(sig.evidence?.ip)}</span></div>
                  <div><span className="ag-mono">内容指纹</span><code>{sig.evidence?.agreement?.contentSha256}</code></div>
                  <div>
                    <span className="ag-mono">正文绑定</span>
                    <span>{sig.contentMatch === true ? "一致（发送后正文未改动）" : sig.contentMatch === false ? "不一致：正文在发送后被改动" : "未绑定（旧版记录）"}</span>
                  </div>
                  <div><span className="ag-mono">签名图哈希</span><code>{sig.evidence?.signatureImageSha256}</code></div>
                  <div><span className="ag-mono">UA 哈希</span><code>{sig.evidence?.userAgentSha256 || "—"}</code></div>
                  <div><span className="ag-mono">时间戳</span><span>{sig.tsa ? `${sig.tsa.time} · ${sig.tsa.url}` : "未取到（不影响签名本身）"}</span></div>
                  <div><span className="ag-mono">重算摘要</span><code>{sig.computed}</code></div>
                  <div><span className="ag-mono">存档摘要</span><code>{sig.stored}</code></div>
                  <div><span className="ag-mono">完成封存</span><span>{sig.completionMatch === true ? "一致" : sig.completionMatch === false ? "不一致" : sig.agreementStatus === "COMPLETED" ? "未封存（旧版记录）" : "尚在签署中，完成时封存"}</span></div>
                  <div>
                    <span className="ag-mono">服务端签名</span>
                    <span>{sigLabel(sig.evidenceSignature)}</span>
                  </div>
                  <div>
                    <span className="ag-mono">完成签名</span>
                    <span>{sigLabel(sig.completionSignature)}</span>
                  </div>
                  <div>
                    <span className="ag-mono">事件链</span>
                    <span>{chainLabel(sig.eventChain)}</span>
                  </div>
                  <div><span className="ag-mono">摘要版本</span><span>{sig.hashV === 1 ? "v1（旧版，不含期限字段）" : `v${sig.hashV}`}</span></div>
                </div>

                <p className="ag-note" style={{ marginTop: 18 }}>
                  邮箱在展示时打码；摘要按完整记录计算。
                </p>
                <p className="ag-note">
                  「重算摘要」是把上面这些字段按固定顺序规范化后做 SHA-256 的结果。
                  {sig.legacy
                    ? "这份记录用的是旧版摘要：它只覆盖标题、正文、同意文案、截止时间与签署人，不覆盖期限字段与完成时间。"
                    : sig.completionMatch === false
                      ? "摘要一致，但完成封存不一致：完成时间或最终期限在完成后被改动过。"
                      : "它与存档一致，说明上面列出的字段自签署以来没有被改动过。"}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}
