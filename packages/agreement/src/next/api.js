import { runtimeFor } from "./runtime.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const fail = (e) => json({ error: e?.message || "请求失败" }, e?.status || 400);

function clientIp(req) {
  return req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
}

/** Admin gate: 503 when unconfigured, 401 when anonymous, 404 when not allowed. */
async function adminGate(config, req, agreementId) {
  if (typeof config.auth?.getAdmin !== "function") {
    return { error: json({ error: "管理端未配置认证：请提供 auth.getAdmin" }, 503) };
  }
  const who = await config.auth.getAdmin(req);
  if (!who) return { error: json({ error: "未登录" }, 401) };

  if (config.tenancy === "multi") {
    if (agreementId && typeof config.auth.canManage === "function") {
      const detail = await runtimeFor(config).service.getAgreementDetail(agreementId);
      if (!detail || !(await config.auth.canManage(req, detail))) {
        return { error: json({ error: "未找到该合同" }, 404) };
      }
    }
  }
  return { who };
}

/** Missing browser is a deployment choice, not a bad request. */
async function renderPdf(pdf, req, id, number) {
  try {
    return await pdf(req, id, number);
  } catch (e) {
    const missing = /Chromium|ENOENT|spawn/i.test(String(e?.message || ""));
    e.status = missing ? 501 : 500;
    if (missing) e.message = `PDF 渲染未启用：${e.message}`;
    throw e;
  }
}

async function readBody(req) {
  return req.json().catch(() => ({}));
}

async function route(config, req, parts) {
  const { service, pdf } = runtimeFor(config);
  const [head, ...rest] = parts;
  const method = req.method.toUpperCase();

  // ── public: signing ────────────────────────────────────────
  if (head === "sign" && rest.length) {
    const token = rest[0];
    if (rest.length === 1 && method === "GET") {
      const view = await service.getSignerView(token, req.headers.get("cookie")?.match(/agreement_signer=([^;]+)/)?.[1]);
      return view ? json(view) : json({ error: "链接无效或已失效" }, 404);
    }
    if (rest.length === 2 && rest[1] === "submit" && method === "POST") {
      const body = await readBody(req);
      const out = await service.signAgreement(
        token,
        { image: body.image },
        { ip: clientIp(req), ua: req.headers.get("user-agent") || "" }
      );
      return json({ ok: true, ...out });
    }
    if (rest.length === 2 && rest[1] === "pdf" && method === "GET") {
      const view = await service.getSignerView(token);
      if (!view) return json({ error: "链接无效或已失效" }, 404);
      const out = await renderPdf(pdf, req, view.agreement.id, view.agreement.number);
      return pdfResponse(out);
    }
  }

  // ── public: verification ───────────────────────────────────
  if (head === "verify") {
    const url = new URL(req.url);
    if (rest.length === 0 && method === "GET") {
      const st = await service.verifyByNumber(url.searchParams.get("number") || "");
      if (!st) return json({ error: "未找到该合同编号" }, 404);
      return json({
        number: st.number,
        status: st.status,
        createdAt: st.createdAt,
        completedAt: st.completedAt,
        contentHash: st.contentHash,
        signers: st.signers.map((s) => ({ label: s.label, signed: s.signed, signedAt: s.signedAt })),
      });
    }
    if (rest[0] === "signature" && method === "GET") {
      const out = await service.verifyByCert(url.searchParams.get("number") || "", url.searchParams.get("cert") || "");
      return out.found ? json(out) : json({ error: "未找到" }, 404);
    }
  }

  // ── admin ──────────────────────────────────────────────────
  if (head !== "agreements") return json({ error: "not found" }, 404);

  const gate = await adminGate(config, req, rest[0]);
  if (gate.error) return gate.error;

  if (rest.length === 0) {
    if (method === "GET") {
      const rows = await service.listAgreements({ limit: Number(new URL(req.url).searchParams.get("limit")) || 100 });
      return json({ agreements: rows });
    }
    if (method === "POST") {
      const body = await readBody(req);
      const id = await service.createDraft(
        {
          title: body.title,
          body: body.body,
          consentText: body.consentText,
          expiresAt: body.expiresAt,
          signers: body.signers,
        },
        body.actor || "operator"
      );
      if (body.send) {
        const sent = await service.sendAgreement(id, req);
        return json({ ok: true, id, links: sent.links });
      }
      return json({ ok: true, id });
    }
  }

  const id = rest[0];
  if (rest.length === 1 && method === "GET") {
    const detail = await service.getAgreementDetail(id);
    return detail ? json(detail) : json({ error: "未找到" }, 404);
  }
  if (rest.length === 2 && rest[1] === "send" && method === "POST") {
    const out = await service.sendAgreement(id, req);
    return json({ ok: true, ...out });
  }
  if (rest.length === 2 && rest[1] === "links" && method === "GET") {
    return json(await service.getLinks(id, req));
  }
  if (rest.length === 2 && rest[1] === "void" && method === "POST") {
    const body = await readBody(req);
    await service.voidAgreement(id, body.reason || "");
    return json({ ok: true });
  }
  if (rest.length === 4 && rest[1] === "signers" && rest[3] === "link" && method === "POST") {
    return json({ ok: true, ...(await service.rotateLink(id, rest[2], req)) });
  }
  if (rest.length === 2 && rest[1] === "pdf" && method === "GET") {
    const detail = await service.getAgreementDetail(id);
    if (!detail) return json({ error: "未找到" }, 404);
    const out = await renderPdf(pdf, req, id, detail.agreement?.number || id);
    return pdfResponse(out);
  }

  return json({ error: "not found" }, 404);
}

function pdfResponse({ buf, filename }) {
  const safe = String(filename).replace(/["\\]/g, "");
  return new Response(buf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${safe}"`,
      "cache-control": "no-store",
    },
  });
}

export function createHandlers(config) {
  const handler = async (req, ctx) => {
    try {
      const url = new URL(req.url);
      const prefix = "/api/agreement";
      const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
      const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
      return await route(config, req, parts);
    } catch (e) {
      return fail(e);
    }
  };
  return { GET: handler, POST: handler, PATCH: handler, DELETE: handler };
}
