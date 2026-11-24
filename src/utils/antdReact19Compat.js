"use client";

/**
 * antdReact19Compat — antd v5 × React 19 renderer bridge.
 *
 * Next.js 15 (App Router) aliases `react` / `react-dom` to its bundled
 * React 19.2 canary at runtime, so antd v5 — which officially supports
 * React 16–18 — logs:
 *
 *   Warning: [antd: compatible] antd v5 support React is 16 ~ 18.
 *   see https://u.ant.design/v5-for-19 for compatible.
 *
 * The warning (and the underlying breakage of Wave / message / notification /
 * modal portals) comes from antd's `defaultReactRender`, which is only used
 * when no compatible renderer has been registered. Registering one via
 * `unstableSetRender` replaces that path entirely, so the warning is never
 * emitted and the portalled components use `createRoot` correctly.
 *
 * This is byte-for-byte the logic of the official
 * `@ant-design/v5-patch-for-react-19` package (v1.0.3) — reproduced in-app
 * because that package declares a `react >= 19` peer while this project
 * pins `react ^18.3.1`.
 */
import { unstableSetRender } from "antd";
import { createRoot } from "react-dom/client";

unstableSetRender(function (node, container) {
  container._reactRoot || (container._reactRoot = createRoot(container));
  const root = container._reactRoot;
  root.render(node);
  return function () {
    return new Promise(function (resolve) {
      setTimeout(function () {
        root.unmount();
        resolve();
      }, 0);
    });
  };
});

export default {};
