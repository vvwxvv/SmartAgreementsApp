// scripts/smoke-mongo.mjs - end-to-end smoke on a real mongod (memory replica set).
// Exercises create -> send -> sign -> verify through the same service the app uses.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { createStorage, createAgreementService } from "../packages/agreement/src/core/index.js";
import { signedPngDataUrl } from "../tests/helpers/signature-png.mjs";

const mongo = await MongoMemoryReplSet.create({
  binary: { version: process.env.MONGOMS_VERSION || "7.0.24" },
  replSet: { count: 1, storageEngine: "wiredTiger" },
});
const uri = mongo.getUri("agreement_smoke");
const client = new MongoClient(uri);
await client.connect();
const db = client.db("agreement_smoke");
const storage = createStorage(db, { ObjectId });
const service = createAgreementService({
  storage: async () => storage,
  baseUrl: "http://localhost:3000",
  secrets: { signSecret: "smoke-secret", linkKey: "s".repeat(32) },
  tsa: async () => ({ ok: false }),
});

const id = await service.createDraft(
  { title: "Mongo smoke", body: "<p>body</p>", consentText: "C", termMonths: 12, signers: [{ email: "smoke@example.com" }] },
  "smoke"
);
const sent = await service.sendAgreement(id, {});
const token = sent.links[0].url.substring(sent.links[0].url.lastIndexOf("/") + 1);
await service.signAgreement(token, { image: signedPngDataUrl(), contentHash: sent.contentHash }, { ip: "10.1.1.1", ua: "smoke" });

const detail = await service.getAgreementDetail(id);
const signerId = detail.signers[0].id;
const ok = await service.verifySignature({ agreementId: id, signerId, cert: "" });

await storage.setAgreementFields(id, { completionHash: null });
const shed = await service.verifySignature({ agreementId: id, signerId, cert: "" });

const result = {
  status: detail.agreement.status,
  hashV: ok.hashV,
  contentMatch: ok.contentMatch,
  termEndMatch: ok.termEndMatch,
  completionMatch: ok.completionMatch,
  verified: ok.verified,
  afterSealDeletion: { completionMatch: shed.completionMatch, verified: shed.verified },
};
console.log(JSON.stringify(result));
const good = result.status === "COMPLETED" && result.verified === true && result.completionMatch === true;
const downgradeBlocked = result.afterSealDeletion.completionMatch === false && result.afterSealDeletion.verified === false;
await client.close();
await mongo.stop();
if (!good || !downgradeBlocked) {
  console.error("SMOKE FAILED");
  process.exit(1);
}
console.log("SMOKE OK");
