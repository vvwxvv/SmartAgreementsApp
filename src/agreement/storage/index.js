/** Compatibility surface for code that still imports the repository directly. */
import { ObjectId } from "mongodb";
import { getDb } from "@/app/api/_lib/mongo";
import { createStorage } from "../../../packages/agreement/src/core/index.js";

export { createStorage };

let cached = null;
export async function getStorage() {
  if (cached) return cached;
  cached = createStorage(await getDb(), { ObjectId });
  return cached;
}
