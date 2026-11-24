import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { resolveDataSource } from "@/lib/dataSource";
import { getDb } from "@/app/api/_lib/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function dataDir() {
  return process.env.LOCAL_DATA_DIR
    ? path.resolve(process.env.LOCAL_DATA_DIR)
    : path.join(process.cwd(), "src", "data", "collections");
}

async function readManifest() {
  const file = path.join(dataDir(), ".csv-seed.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const m = JSON.parse(raw);
    if (!m || typeof m !== "object" || !m.models) return null;
    return { file, manifest: m };
  } catch {
    return null;
  }
}

/** 示例数据状态：只在本地文件数据源可用。 */
export async function GET(req) {
  const denied = await requireAdmin(req); if (denied) return denied;
  if (resolveDataSource().resolved !== "local") {
    return NextResponse.json({ seeded: false, reason: "mongo" }, { headers: NO_STORE });
  }
  const found = await readManifest();
  if (!found) return NextResponse.json({ seeded: false }, { headers: NO_STORE });

  const db = await getDb();
  const idsOf = (name) => (Array.isArray(found.manifest.models[name]) ? found.manifest.models[name] : []);
  const counts = {};
  for (const name of Object.keys(found.manifest.models)) {
    const ids = idsOf(name);
    counts[name] = ids.length ? await db.collection(name).countDocuments({ _id: { $in: ids } }) : 0;
  }
  return NextResponse.json({
    seeded: true,
    seededAt: found.manifest.seededAt,
    source: found.manifest.source,
    counts,
    total: Object.values(counts).reduce((n, v) => n + v, 0),
  }, { headers: NO_STORE });
}

/** 只删除清单里的示例文档；运营自己建的数据不受影响。 */
export async function DELETE(req) {
  const denied = await requireAdmin(req); if (denied) return denied;
  if (resolveDataSource().resolved !== "local") {
    return NextResponse.json({ error: "示例数据只存在于本地模式" }, { status: 400, headers: NO_STORE });
  }
  const found = await readManifest();
  if (!found) return NextResponse.json({ error: "没有示例数据清单" }, { status: 404, headers: NO_STORE });

  const db = await getDb();
  const removed = {};
  for (const [name, ids] of Object.entries(found.manifest.models)) {
    if (!Array.isArray(ids) || !ids.length) { removed[name] = 0; continue; }
    const res = await db.collection(name).deleteMany({ _id: { $in: ids } });
    removed[name] = res.deletedCount || 0;
  }
  await fs.rm(found.file, { force: true });
  return NextResponse.json({ ok: true, removed }, { headers: NO_STORE });
}
