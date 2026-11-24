import Link from "next/link";

/**
 * 自定义 404。
 *
 * 不用 Next 内置的 not-found 界面：在 App Router 里，动态路由（例如
 * /print/[id] 用错 key）走到 notFound() 时，内置界面会被当成客户端组件
 * 重新渲染，dev 下会报
 *   "Encountered a script tag while rendering React component"
 * 这个纯静态版本没有脚本，也不依赖任何客户端组件。
 */
export const metadata = { title: "页面不存在 · 404" };

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "ui-sans-serif, -apple-system, 'PingFang SC', sans-serif", color: "#111", background: "#fff", padding: 24 }}>
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, letterSpacing: "0.18em", color: "#9a9a95" }}>
          404 · NOT FOUND
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 300, letterSpacing: "-0.01em", margin: "14px 0 10px" }}>
          页面不存在
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.8, color: "#555", margin: "0 0 22px" }}>
          链接可能已过期、已被撤回，或没有访问权限。
        </p>
        <Link href="/" style={{ fontSize: 13, color: "#111", textDecoration: "underline", textUnderlineOffset: 4 }}>
          返回首页
        </Link>
      </div>
    </main>
  );
}
