/**
 * Meta — 文档 head 的静态标签（Server Component）。
 *
 * 这里刻意不放 "use client"：head 一旦包含 client 组件，Next 就会把整段 head
 * 交给客户端 React 渲染，head 里的主题预置 `<script>` 随之触发
 * "Encountered a script tag while rendering React component"。
 *
 * 动态 SEO（来自 Meta 文档）由 MetaRuntime 在客户端写入 document，
 * 它返回 null，不产生任何标签。
 */
import MetaRuntime from "./MetaRuntime";

export default function Meta() {
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta property="og:type" content="web" />
      <MetaRuntime />
    </>
  );
}
