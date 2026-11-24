"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PatternPad from "@/components/forms/fields/PatternPadField";
import AlertInfo from "@/components/alerts/AlertInfo";

export default function AdminPatternGate() {
  const router = useRouter();
  const params = useSearchParams();

  const [configured, setConfigured] = useState(null); // null = 加载中
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [p1, setP1] = useState([]);
  const [p2, setP2] = useState([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const infoBtn = useRef(null);
  const infoPop = useRef(null);

  // Close the help popover on Escape or a click outside. Keeping the page to
  // just the two pads was an explicit request; the explanation lives in here.
  useEffect(() => {
    if (!showInfo) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setShowInfo(false); };
    const onDown = (e) => {
      if (infoPop.current?.contains(e.target)) return;
      if (infoBtn.current?.contains(e.target)) return;
      setShowInfo(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [showInfo]);

  useEffect(() => {
    fetch("/api/admin/gate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setConfigured(Boolean(d.configured));
        setTotpEnabled(Boolean(d.totp));
      })
      .catch(() => setConfigured(false));
  }, []);

  const ready = p1.length >= 4 && p2.length >= 4;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!configured) {
        throw new Error("管理入口尚未配置：请在服务器运行 npm run init:admin -- --p1=... --p2=...");
      }
      const r = await fetch("/api/admin/gate/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p1, p2, totp: code }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(d.error || "手势不匹配");
        err.field = d.code;
        throw err;
      }
      // Only same-site paths: "//evil.example" is protocol-relative and would
      // turn the post-unlock redirect into an open redirect.
      const raw = params.get("next") || "/";
      const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : "/";
      router.replace(next);
      router.refresh();
    } catch (e) {
      setError(e.message);
      if (e.field === "totp") {
        // The gestures were fine; only the code was wrong. Keep the drawings.
        setCode("");
      } else {
        setP1([]);
        setP2([]);
        setCode("");
      }
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!ready || busy || !configured) return;
    // With a second factor the code triggers the submit, not the second pad.
    if (totpEnabled && code.length !== 6) return;
    submit();
  }, [p1, p2, code, ready, busy, configured, totpEnabled]);

  if (configured === null) {
    return <div className="ag-mono" style={{ marginTop: 40 }}>Loading…</div>;
  }

  if (!configured) {
    return (
      <div style={{ marginTop: 34 }}>
        <p className="ag-sub" style={{ maxWidth: 520, marginBottom: 18 }}>
          管理入口尚未配置。请在有数据的服务器上运行一次：
        </p>
        <pre className="ag-mono" style={{ background: "#f5f5f5", padding: 12, overflowX: "auto" }}>
          npm run init:admin -- --p1=1,2,3,6 --p2=9,8,7,4
        </pre>
        <p className="ag-note" style={{ marginTop: 16, maxWidth: 520 }}>
          两个手势必须不同，各 4–9 个点。服务端只保存 hash；设置完成后刷新本页。
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 34 }}>
      <button
        ref={infoBtn}
        type="button"
        className="ag-gate-help"
        aria-label="使用说明"
        aria-expanded={showInfo}
        onClick={() => setShowInfo((v) => !v)}
      >
        i
      </button>

      {showInfo ? (
        <div ref={infoPop} className="ag-gate-help-pop" role="dialog" aria-label="使用说明">
          <p><b>手势一 / 手势二</b>：依次连点，每个至少 4 个点；两个都正确后自动进入，不需要点按钮。</p>
          <p className="ag-note" style={{ margin: "12px 0 0" }}>
            默认每次打开都要画两个手势；服务端只保存 hash，不保存轨迹。忘记手势时在本机运行
            <code style={{ margin: "0 4px" }}>node scripts/reset-admin-gate.mjs</code>
            清空后重新设置。
          </p>
        </div>
      ) : null}

      <div className="ag-gate">
        <div className="ag-gate-cell">
          <PatternPad onComplete={setP1} disabled={busy} hint="" />
        </div>
        <div className="ag-gate-cell">
          <PatternPad onComplete={setP2} disabled={busy} hint="" />
        </div>
      </div>

      {totpEnabled ? (
        <div style={{ marginTop: 26, maxWidth: 240, marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6 位动态验证码"
            aria-label="动态验证码"
            disabled={busy}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              border: "1px solid #ddd",
              borderRadius: 6,
              fontSize: 18,
              textAlign: "center",
              letterSpacing: "0.25em",
              fontFamily: "ui-monospace, Menlo, monospace",
            }}
          />
        </div>
      ) : null}

      {error ? (
        <div className="ag-gate-error">
          <AlertInfo message={error} messageCn={error} subMessage="" subMessageCn="" buttonText="" buttonTextCn="" onBack={null} />
        </div>
      ) : null}
    </div>
  );
}
