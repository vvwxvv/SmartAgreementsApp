/**
 * Storage boundary for the signing module.
 *
 * The rest of the code never touches a MongoDB collection directly. It asks
 * this repository for domain operations, which keeps the business rules
 * portable (Mongo today, Prisma/SQL/memory later) and — more importantly —
 * gives every conditional write a single, auditable implementation.
 *
 * Two operations are deliberately stateful and must stay atomic:
 *   commitSignature()  only writes when the signer is still unsigned
 *   transition()       only changes status from the expected state
 * Both return whether the write actually happened; callers decide what to do.
 */
const A = "Agreement";
const S = "AgreementSigner";
const E = "SigningEvent";
const F = "AgreementAttachment";

/**
 * @param db driver-agnostic database handle (findOne/updateOne/... subset)
 * @param ObjectId driver-provided id constructor; keeps this file free of any
 *        top-level driver import, so non-Mongo hosts never load `mongodb`.
 */
export function createStorage(db, { ObjectId } = {}) {
  if (!ObjectId) throw new Error("createStorage: ObjectId constructor is required");
  const oid = (id) => (id instanceof ObjectId ? id : new ObjectId(String(id)));
  const isOid = (id) => /^[a-f0-9]{24}$/i.test(String(id || ""));

  const agreements = db.collection(A);
  const signers = db.collection(S);
  const events = db.collection(E);
  const partyInfoRows = db.collection("PartyInfo");
  const attachments = db.collection(F);

  return {
    newId() {
      return new ObjectId();
    },

    /* ── party info (local only) ─────────────────── */

    async insertPartyInfo(doc) {
      await partyInfoRows.insertOne(doc);
      return doc;
    },

    async getPartyInfo(id) {
      if (!isOid(id)) return null;
      return partyInfoRows.findOne({ _id: oid(id) });
    },

    async updatePartyInfo(id, patch) {
      if (!isOid(id)) return { applied: false };
      const res = await partyInfoRows.updateOne({ _id: oid(id) }, { $set: { ...patch, updatedAt: new Date() } });
      return { applied: res.matchedCount === 1 };
    },

    async listPartyInfos({ limit = 200, includeArchived = false } = {}) {
      const filter = includeArchived ? {} : { archivedAt: null };
      return partyInfoRows.find(filter).sort({ name: 1 }).limit(limit).toArray();
    },

    async archivePartyInfo(id) {
      if (!isOid(id)) return { applied: false };
      const res = await partyInfoRows.updateOne({ _id: oid(id) }, { $set: { archivedAt: new Date(), updatedAt: new Date() } });
      return { applied: res.matchedCount === 1 };
    },

    /* ── agreements ───────────────────────────────────────── */

    async countThisYear(year) {
      return agreements.countDocuments({ number: { $regex: `^AGR-${year}-` } });
    },

    /** Allocate the next agreement number for a year.
     *  A counter document makes this atomic under Mongo; the local store falls
     *  back to read-modify-write (single process) and seeds from existing rows
     *  so an upgrade does not restart at 0001. Deleting agreements never
     *  rewinds the sequence. */
    async nextAgreementNumber(year) {
      const key = "AGR-" + year;
      const counters = db.collection("Counter");
      if (typeof counters.findOneAndUpdate === "function") {
        // Seed once, atomically: two first-time writers must not both decide the
        // starting point. $setOnInsert is a no-op when the document exists.
        const existingCounter = await counters.findOne({ _id: key });
        if (!existingCounter) {
          const seed = await agreements.countDocuments({ number: { $regex: "^AGR-" + year + "-" } });
          try {
            await counters.updateOne({ _id: key }, { $setOnInsert: { seq: seed } }, { upsert: true });
          } catch (e) {
            // Two first-time writers can race the upsert; the loser gets E11000
            // and only needs to continue — the document now exists.
            if (!e || e.code !== 11000) throw e;
          }
        }
        const res = await counters.findOneAndUpdate(
          { _id: key },
          { $inc: { seq: 1 } },
          { returnDocument: "after" }
        );
        const doc = res && (res.value !== undefined ? res.value : res);
        if (doc && Number.isFinite(doc.seq)) return "AGR-" + year + "-" + String(doc.seq).padStart(4, "0");
      }
      const existing = await counters.findOne({ _id: key });
      const seed = existing && Number.isFinite(existing.seq)
        ? existing.seq
        : await agreements.countDocuments({ number: { $regex: "^AGR-" + year + "-" } });
      const next = seed + 1;
      if (existing) await counters.updateOne({ _id: key }, { $set: { seq: next } });
      else await counters.insertOne({ _id: key, seq: next });
      return "AGR-" + year + "-" + String(next).padStart(4, "0");
    },

    /** Claim the original before a renewal draft is created.
     *  Mongo: atomic conditional update. Local JSON: atomic only within one
     *  process — multi-instance deployments require Mongo. */
    async claimRenewalStart(id, staleBefore) {
      const now = new Date();
      const first = await agreements.updateOne(
        { _id: oid(id), renewedBy: null, renewalStatus: { $ne: "renewing" } },
        { $set: { renewalStatus: "renewing", renewalClaimAt: now, renewalDeadline: null } }
      );
      if (first.modifiedCount === 1) return { applied: true, claimAt: now };
      // A claim may be stale (crashed process). Re-claim only if the recorded
      // claimAt is the one we read, so two cleaners cannot both win.
      const doc = await agreements.findOne({ _id: oid(id) });
      if (!doc || doc.renewedBy) return { applied: false };
      const claimedAt = doc.renewalClaimAt ? new Date(doc.renewalClaimAt).getTime() : 0;
      if (doc.renewalStatus === "renewing" && claimedAt && claimedAt < staleBefore) {
        const second = await agreements.updateOne(
          { _id: oid(id), renewalStatus: "renewing", renewalClaimAt: doc.renewalClaimAt },
          { $set: { renewalClaimAt: now } }
        );
        return { applied: second.modifiedCount === 1, claimAt: now };
      }
      return { applied: false, claimAt: null };
    },

    async findRenewalDrafts(id) {
      return agreements.find({ renewalOf: String(id), status: "DRAFT" }).toArray();
    },

    async finishRenewal(id, newId, deadline) {
      const res = await agreements.updateOne(
        { _id: oid(id), renewalStatus: "renewing", renewedBy: null },
        { $set: { renewedBy: newId, renewalDeadline: deadline || null, renewalClaimAt: null } }
      );
      return { applied: res.modifiedCount === 1 };
    },

    async releaseRenewal(id, claimAt) {
      const res = await agreements.updateOne(
        { _id: oid(id), renewalStatus: "renewing", renewedBy: null, renewalClaimAt: claimAt },
        { $set: { renewalStatus: null, renewalClaimAt: null } }
      );
      return { applied: res.modifiedCount === 1 };
    },

    async claimRenewal(id, newId, deadline) {
      const res = await agreements.updateOne(
        { _id: oid(id), renewedBy: null, renewalStatus: { $ne: "renewing" } },
        { $set: { renewedBy: newId, renewalStatus: "renewing", renewalDeadline: deadline || null, updatedAt: new Date() } }
      );
      return { applied: res.modifiedCount === 1 };
    },

    async setAgreementFields(id, patch) {
      if (!isOid(id)) return { applied: false };
      const res = await agreements.updateOne({ _id: oid(id) }, { $set: { ...patch, updatedAt: new Date() } });
      return { applied: res.matchedCount === 1 };
    },

    async insertAgreement(doc) {
      await agreements.insertOne(doc);
      return doc;
    },

    async getAgreement(id) {
      // A malformed id is "not found", not a 500: keeps bad input from
      // surfacing driver errors (or their messages) to the caller.
      if (!isOid(id)) return null;
      return agreements.findOne({ _id: oid(id) });
    },

    async findAgreementByNumber(number) {
      return agreements.findOne({ number: String(number || "").trim().toUpperCase() });
    },

    /** Status-guarded patch. `from` lists the states it may leave. */
    async transition(id, from, patch, inc = {}) {
      if (!isOid(id)) return { applied: false };
      const update = { $set: { ...patch, updatedAt: new Date() } };
      if (Object.keys(inc).length) update.$inc = inc;
      const res = await agreements.updateOne(
        { _id: oid(id), status: { $in: from } },
        update
      );
      return { applied: res.modifiedCount === 1 };
    },

    /** Draft edits: title/body/consent/expiry only, and only while DRAFT. */
    async updateDraft(id, patch) {
      if (!isOid(id)) return { applied: false };
      const res = await agreements.updateOne(
        { _id: oid(id), status: "DRAFT" },
        { $set: { ...patch, updatedAt: new Date() } }
      );
      return { applied: res.matchedCount === 1 };
    },

    async listAgreements(limit, before) {
      const filter = before ? { createdAt: { $lt: new Date(before) } } : {};
      return agreements.find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
    },

    /* ── signers ──────────────────────────────────────────── */

    async insertSigners(rows) {
      if (!rows.length) return rows;
      await signers.insertMany(rows);
      return rows;
    },

    async listSigners(agreementId) {
      if (!isOid(agreementId)) return [];
      return signers.find({ agreementId: oid(agreementId) }).sort({ order: 1 }).toArray();
    },

    async listSignersForAgreements(ids) {
      if (!ids.length) return [];
      return signers.find({ agreementId: { $in: ids } }).toArray();
    },

    async getSigner(signerId, agreementId) {
      if (!isOid(signerId) || !isOid(agreementId)) return null;
      return signers.findOne({ _id: oid(signerId), agreementId: oid(agreementId) });
    },

    async findSignerByTokenHash(hash) {
      return signers.findOne({ accessTokenHash: hash });
    },

    async unsetSignerField(signerId, field) {
      await signers.updateOne({ _id: oid(signerId) }, { $unset: { [field]: "" } });
      return { applied: true };
    },

    async updateSigner(signerId, patch) {
      const res = await signers.updateOne({ _id: oid(signerId) }, { $set: { ...patch, updatedAt: new Date() } });
      return { applied: res.matchedCount === 1 };
    },

    /**
     * The only way a signature is written.
     *
     * The filter is the concurrency control: two people (or two tabs) racing
     * on the same row both reach the database, exactly one matches
     * `signedAt: null`, and the loser gets applied=false instead of overwriting
     * the winner. Never replace this with read-then-write.
     */
    async commitSignature({ signerId, agreementId, email, patch }) {
      const res = await signers.updateOne(
        {
          _id: oid(signerId),
          agreementId: oid(agreementId),
          email,
          signedAt: null,
        },
        { $set: { ...patch, updatedAt: patch.updatedAt || new Date() } }
      );
      return { applied: res.modifiedCount === 1 };
    },

    async countUnsigned(agreementId) {
      if (!isOid(agreementId)) return 0;
      return signers.countDocuments({ agreementId: oid(agreementId), signedAt: null });
    },

    /* ── attachments (one document per file) ──────────────── */

    async insertAttachment(agreementId, doc) {
      await attachments.insertOne({ ...doc, agreementId: oid(agreementId) });
      return doc;
    },

    async listAttachments(agreementId) {
      if (!isOid(agreementId)) return [];
      return attachments.find({ agreementId: oid(agreementId) }).sort({ createdAt: 1 }).toArray();
    },

    async getAttachment(id, agreementId) {
      if (!isOid(id) || !isOid(agreementId)) return null;
      return attachments.findOne({ _id: oid(id), agreementId: oid(agreementId) });
    },

    async deleteAttachment(id, agreementId) {
      if (!isOid(id) || !isOid(agreementId)) return { applied: false };
      const res = await attachments.deleteOne({ _id: oid(id), agreementId: oid(agreementId) });
      return { applied: res.deletedCount === 1 };
    },

    /* ── audit trail ──────────────────────────────────────── */

    async appendEvent({ agreementId, signerId = null, type, ipHash = null, meta = null, at = new Date(), prevHash = null, hash = null }) {
      await events.insertOne({
        _id: new ObjectId(),
        agreementId: oid(agreementId),
        signerId: signerId ? oid(signerId) : null,
        type,
        at: at ? new Date(at) : new Date(),
        ipHash,
        meta: meta ? String(meta).slice(0, 500) : null,
        prevHash: prevHash || null,
        hash: hash || null,
      });
    },

    async listEvents(agreementId, limit = 50) {
      return events
        .find({ agreementId: oid(agreementId) })
        .sort({ at: -1 })
        .limit(limit)
        .toArray();
    },
  };
}
