/**
 * Party address book. Deliberately stores no identity documents.
 */
import { cleanPartyInput } from "./domain.js";

export function createParties(ctx) {
  const { getStorage } = ctx;


async function listPartyInfos(opts = {}) {
  const store = await getStorage();
  return store.listPartyInfos(opts);
}

async function getPartyInfo(id) {
  const store = await getStorage();
  return store.getPartyInfo(id);
}

async function createPartyInfo(input = {}) {
  const store = await getStorage();
  const fields = cleanPartyInput(input, { requireName: true });
  const now = new Date();
  const doc = {
    _id: store.newId(),
    ...fields,
    isSelf: fields.isSelf === true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await store.insertPartyInfo(doc);
  return doc;
}

async function updatePartyInfo(id, patch = {}) {
  const store = await getStorage();
  const fields = cleanPartyInput(patch);
  if (patch.unarchive === true) fields.archivedAt = null;
  if (!Object.keys(fields).length) throw new Error("没有可更新的字段");
  return store.updatePartyInfo(id, fields);
}

async function archivePartyInfo(id) {
  const store = await getStorage();
  return store.archivePartyInfo(id);
}

  return { listPartyInfos, getPartyInfo, createPartyInfo, updatePartyInfo, archivePartyInfo };
}
