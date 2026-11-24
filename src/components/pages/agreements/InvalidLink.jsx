import Link from "next/link";

/**
 * 打印/签署链接失效页（Server Component，无客户端依赖）。
 *
 * 为什么不直接用 notFound()：Next 在动态路由里走 notFound() 时，会把内置 404
 * 当作客户端组件重新渲染整棵 layout（含 head 里的主题预置 <script>），dev 环境
 * 就会报 “Encountered a script tag while rendering React component”。
 * 这里直接渲染静态页面，既避免该告警，也给用户一句人话提示。
 */
export default function InvalidLink({ reason = "链接无效或已过期" }) {
  return (
    <main className="ag-root" style={{ minHeight: "100vh", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 440 }}>
        <div className="ag-mono" style={{ fontSize: 10.5, letterSpacing: ".18em", color: "#9a9a95" }}>LINK · EXPIRED</div>
        <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: "-.01em", margin: "14px 0 10px" }}>{reason}</h1>
        <p style={{ fontSize: 14, lineHeight: 1.85, color: "#555", margin: "0 0 22px" }}>
          请向发件方索取新的链接；合同本身的签署状态不会因为链接过期而改变。
        </p>
        <Link href="/verify" style={{ fontSize: 13, color: "#111", textDecoration: "underline", textUnderlineOffset: 4 }}>
          去核验合同
        </Link>
      </div>
    </main>
  );
}
