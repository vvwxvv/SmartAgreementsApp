/**
 * Public surface of the signing module.
 *
 * Drop `src/agreement/` into another Next.js app, add the four Prisma models
 * from PLUGIN.md, mount the routes, and call these functions from your own
 * access-control code.
 */
export {
  createDraft,
  sendAgreement,
  rotateLink,
  getLinks,
  voidAgreement,
  signAgreement,
  getSignerView,
  getAgreementDetail,
  listAgreements,
  getStatus,
  verifyByNumber,
  verifyByCert,
  verifySignature,
  buildEvidence,
  evidenceHash,
} from "./service";

export { renderAgreementPdf } from "./pdf";
export { timestampDigest } from "./tsa";
