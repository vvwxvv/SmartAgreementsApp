"use client";

/**
 * MetaRuntime — 只做「客户端同步」，不渲染任何标签。
 *
 * 为什么单独拆出来：`<head>` 里一旦有 client 组件，Next 会把整个 head 子树
 * 交给 React 客户端渲染，于是 head 里的 `<script id="theme-init">` 会被
 * React 19 判为「client component 渲染 script」并报错：
 *   Encountered a script tag while rendering React component.
 *
 * 现在的分工：
 *   meta.tsx（server）→ 输出静态 meta/link 标签，head 保持纯服务端
 *   MetaRuntime（client，返回 null）→ 用 useEffect 把动态 SEO 写进 document
 */

import { useEffect } from "react";
import useSiteMeta from "@/hooks/useSiteMeta";

function upsertMeta(attr, key, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel, href) {
  if (!href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export default function MetaRuntime() {
  const { meta } = useSiteMeta();
  const seo = (meta && meta.seo) || {};

  useEffect(() => {
    if (seo.title) document.title = seo.title;
    upsertMeta("name", "description", seo.description);
    upsertMeta("name", "keywords", seo.keywords);
    upsertMeta("name", "author", seo.author);
    upsertMeta("property", "og:title", seo.title);
    upsertMeta("property", "og:description", seo.description);
    upsertMeta("property", "og:image", seo.og_image);
    if (seo.icon) {
      upsertLink("icon", seo.icon);
      upsertLink("shortcut icon", seo.icon);
    }
    if (seo.manifest) upsertLink("manifest", seo.manifest);
    if (seo.canonical) upsertLink("canonical", seo.canonical);
  }, [seo.title, seo.description, seo.keywords, seo.author, seo.og_image, seo.icon, seo.manifest, seo.canonical]);

  return null;
}
