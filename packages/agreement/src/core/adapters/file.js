import { createStorage } from "../storage.js";
import { configureFileDb, FileObjectId, getLocalDb } from "./file-db.js";

/**
 * JSON-file adapter for demos, tests and single-process hosts.
 * Not for production concurrency: the conditional writes are atomic only
 * within one Node process.
 */
export function createFileStorage({ dir } = {}) {
  if (!dir) throw new Error("createFileStorage: dir is required");
  configureFileDb(dir);
  return createStorage(getLocalDb(), { ObjectId: FileObjectId });
}
