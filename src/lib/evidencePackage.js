/**
 * Evidence package: one ZIP an operator can hand to a lawyer, an auditor or the
 * other party without giving them access to this application.
 *
 * Contents:
 *   README.txt            what the package is and how to check it by hand
 *   manifest.json         agreement, per-signer evidence, verification results
 *   agreement.pdf         the printed copy (same bytes as /api/.../pdf)
 *   signatures/<id>.png   the signature images, exactly as stored
 *   tsa/<id>.tsr          RFC 3161 tokens (binary), when a timestamp succeeded
 *
 * The manifest also carries a SHA-256 for every other file, so the package is
 * self-checking even after it leaves the server.
 */
import crypto from "node:crypto";
import { createZip } from "../../packages/agreement/src/core/zip.js";
import { renderAgreementPdf } from "@/agreement/pdf";
import { evidenceSigner, getAgreementDetail, getPrintableById, listAttachmentBlobs, verifyEventChain, verifySignature } from "@/agreement/service";

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function readme(agreement) {
  return [
    "Agreement evidence package",
    "==========================",
    "",
    "Contract: " + agreement.number + " — " + agreement.title,
    "Status at export: " + String(agreement.status || ""),
    "",
    "Why this exists",
    "  Every signature below is a SHA-256 digest over a human-readable record",
    "  (who, when, from where, which version of the text, which image).",
    "  Edit any of those fields and the digest stops matching.",
    "",
    "How to check it without this application",
    "  1. Open manifest.json. For each signer, take `evidence` and rebuild the",
    "     canonical JSON (keys sorted, no whitespace).",
    "  2. SHA-256 that JSON and compare it with `signatureHash` in the manifest.",
    "  3. Check `sha256` for agreement.pdf / signatures/*.png against the files.",
    "  4. The audit events form a hash chain (manifest.events). Each event hashes",
    "     its content plus the previous hash; a missing or edited event breaks it.",
    "  4. If tsa/<id>.tsr exists: `openssl ts -reply -in tsa/<id>.tsr -text`.",
    "",
    "Server signature",
    evidenceSigner.publicKey
      ? "  The digests are also signed with the server's Ed25519 key (evidence-key.json)."
      : "  No server signing key is configured for this deployment, so the digests",
    evidenceSigner.publicKey
      ? "  Anyone holding the public key can verify them without database access."
      : "  are unkeyed. Configure AGREEMENT_EVIDENCE_PRIVATE_KEY to enable signing.",
    "",
    "Limits",
    "  Even with the server signature, this package does not prove the signer's",
    "  identity: no identity check is performed by this application.",
    "",
  ].join("\n");
}

/**
 * @param {{ req: Request, id: string }} args
 * @returns {Promise<{ zip: Buffer, filename: string, manifest: object }>}
 */
export async function buildEvidencePackage({ req, id, renderPdf = renderAgreementPdf }) {
  const detail = await getAgreementDetail(id);
  if (!detail) {
    const err = new Error("合同不存在");
    err.status = 404;
    throw err;
  }
  const printable = await getPrintableById(id);
  if (!printable) {
    const err = new Error("合同不存在");
    err.status = 404;
    throw err;
  }

  const signed = detail.signers.filter((s) => s.signed);
  if (!signed.length) {
    const err = new Error("还没有人签署，暂时没有可导出的证据");
    err.status = 409;
    throw err;
  }

  const { buf: pdf, filename: pdfName } = await renderPdf(req, id, detail.agreement.number);

  const signers = [];
  const files = [];

  for (const signer of detail.signers) {
    const print = printable.signers.find((p) => p.id === signer.id) || {};
    const verify = signer.signed
      ? await verifySignature({ agreementId: id, signerId: signer.id, cert: "" }).catch(() => ({ found: false }))
      : null;

    let tsaFile = null;
    if (print.tsaToken) {
      tsaFile = "tsa/" + signer.id + ".tsr";
      files.push({ name: tsaFile, data: Buffer.from(String(print.tsaToken), "base64") });
    }

    let imageFile = null;
    if (print.image) {
      const base64 = String(print.image).replace(/^data:image\/png;base64,/, "");
      imageFile = "signatures/" + signer.id + ".png";
      files.push({ name: imageFile, data: Buffer.from(base64, "base64") });
    }

    signers.push({
      id: signer.id,
      email: signer.email,
      label: signer.label || null,
      order: signer.order,
      signedAt: signer.signedAt || null,
      signedIp: signer.signedIp || null,
      signatureHash: signer.signatureHash || null,
      files: { image: imageFile, tsa: tsaFile },
      evidence: verify && verify.found ? verify.evidence : null,
      verification: verify && verify.found
        ? {
            match: verify.match,
            contentMatch: verify.contentMatch,
            termEndMatch: verify.termEndMatch,
            completionMatch: verify.completionMatch,
            requiresSeal: verify.requiresSeal,
            legacy: verify.legacy,
            computed: verify.computed,
            stored: verify.stored,
            verified: verify.verified,
            evidenceSignature: verify.evidenceSignature,
            completionSignature: verify.completionSignature,
          }
        : null,
    });
  }

  const signedRows = signers.filter((s) => s.signedAt);
  const contentChecks = signedRows.length > 0 && signedRows.every((s) => s.verification && s.verification.contentMatch !== false);
  const allVerified =
    signedRows.length > 0 &&
    signedRows.length === signers.length &&
    signedRows.every((s) => s.verification && s.verification.verified === true);

  const pdfEntry = "agreement.pdf";
  files.unshift({ name: pdfEntry, data: pdf });

  // Annexes travel with the package: bytes + their own digests.
  const attachmentMeta = [];
  const blobs = await listAttachmentBlobs(id).catch(() => []);
  for (const doc of blobs) {
    const safe = String(doc.name || "attachment").replace(/[^\w.\-\u4e00-\u9fa5]/g, "_").slice(0, 80);
    const file = "attachments/" + String(doc._id) + "-" + safe;
    const data = Buffer.from(doc.data || "", "base64");
    files.push({ name: file, data });
    attachmentMeta.push({ id: String(doc._id), name: doc.name, mime: doc.mime, size: doc.size, sha256: doc.sha256, file });
  }

  if (evidenceSigner.publicKey) {
    files.push({
      name: "evidence-key.json",
      data: Buffer.from(
        JSON.stringify(
          {
            alg: evidenceSigner.alg,
            kid: evidenceSigner.kid,
            x: evidenceSigner.publicKey.x,
            fingerprint: evidenceSigner.fingerprint,
            note: "Ed25519 public key. Signed digests use this deployment's private key.",
          },
          null,
          2
        )
      ),
    });
  }

  const events = await verifyEventChain(id).catch(() => null);

  const checksums = {};
  for (const f of files) checksums[f.name] = sha256(f.data);

  const manifest = {
    schema: "agreement-evidence/1",
    generatedAt: new Date().toISOString(),
    note: evidenceSigner.publicKey
      ? "Ed25519-signed SHA-256 evidence; verify with evidence-key.json. Identity is not verified by this application."
      : "Unkeyed SHA-256 evidence. Identity is not verified by this application.",
    evidenceKey: evidenceSigner.publicKey
      ? { ...evidenceSigner.publicKey, fingerprint: evidenceSigner.fingerprint }
      : null,
    events,
    agreement: {
      id: String(detail.agreement.id),
      number: detail.agreement.number,
      title: detail.agreement.title,
      status: detail.agreement.status,
      createdAt: detail.agreement.createdAt,
      sentAt: detail.agreement.sentAt,
      completedAt: detail.agreement.completedAt,
      contentHash: detail.agreement.contentHash || null,
      hashV: detail.agreement.hashV ?? null,
      termMonths: detail.agreement.termMonths ?? null,
      termEnd: detail.agreement.termEnd || null,
      voidedAt: detail.agreement.voidedAt || null,
      voidReason: detail.agreement.voidReason || null,
    },
    verification: {
      signerCount: signers.length,
      signedCount: signers.filter((s) => s.signedAt).length,
      allVerified,
      contentIntact: contentChecks,
    },
    signers,
    attachments: attachmentMeta,
    files: checksums,
  };

  const entries = [
    { name: "README.txt", data: readme(detail.agreement) },
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) + "\n" },
    ...files,
  ];

  return {
    zip: createZip(entries),
    filename: detail.agreement.number + "-evidence.zip",
    manifest,
    // keep the PDF name available for callers that want to log it
    pdfName,
  };
}
