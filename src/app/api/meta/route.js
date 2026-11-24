// app/api/meta/route.js
//
// The singleton `Meta` document (title, footer, navigation menus, SEO tags,
// form-type options) lives in the MongoDB `Meta` collection. The client reads
// and writes it here via `useSiteMeta()` (GET/PUT /api/meta), and the manager
// page `/manager/meta` edits it.
//
// This route was missing entirely, which made every page in the app emit a
// `GET /api/meta 404` (the nav, footer, NoDataInfo and <Meta/> head all call
// useSiteMeta), and made saving from `/manager/meta` impossible.
//
// It is a small, hand-written route (not the generic CRUD shell) because the
// collection holds a SINGLE document and must always merge over the built-in
// defaults so the app never breaks when the DB is empty/unavailable.

import { NextResponse } from 'next/server';
import { getMetaMerged, updateMetaDoc } from '@/lib/siteMetaServer';
import { enforce, projectMeta } from '@/app/api/_lib/authz';
import { requireAdmin } from "@/lib/requireAdmin";

// Never cache: the doc is editable and the site must reflect saves instantly.
export const dynamic = 'force-dynamic';

const NO_STORE = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

const json = (data, status = 200) =>
  new NextResponse(JSON.stringify(data), { status, headers: NO_STORE });

/** Strip Mongo internals before sending the doc to the browser. */
const clean = (doc) => {
  if (!doc || typeof doc !== 'object') return doc;
  const { _id, ...rest } = doc;
  return rest;
};

// GET — merged Meta document, public subset only (presentation / SEO).
// Deliberately unauthenticated: the public verify page renders the footer the
// operator configures here, and `projectMeta` strips everything else. Writes
// (PUT) still require an admin session.
export async function GET() {
  try {
    const meta = await getMetaMerged();
    return json({ data: projectMeta(meta) });
  } catch (error) {
    console.error('[api/meta] GET failed:', error);
    // `getMetaMerged` already falls back to defaults; this is a belt-and-braces
    // guard so the client always receives a usable 200 payload.
    return json({ data: null, error: error?.message || 'Failed to read site meta' }, 200);
  }
}

// PUT — store a sanitized patch and return the stored doc.
export async function PUT(request) {
  const adminDenied = await requireAdmin(request); if (adminDenied) return adminDenied;
  const denied = await enforce(request);
  if (denied) return denied;
  try {
    let patch;
    try {
      patch = await request.json();
    } catch (parseError) {
      return json({ error: 'Invalid JSON in request body' }, 400);
    }

    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return json({ error: 'Request body must be an object' }, 400);
    }

    // Never allow clients to overwrite Mongo internals.
    delete patch._id;
    delete patch.id;

    const updated = await updateMetaDoc(patch);
    return json({ data: clean(updated), message: 'Updated successfully' });
  } catch (error) {
    console.error('[api/meta] PUT failed:', error);
    return json({ error: error?.message || 'Failed to update site meta' }, 500);
  }
}

// POST — dedupe the singleton collection (keep the newest Meta doc, archive the
// rest). Handy one-shot maintenance call: `curl -X POST /api/meta`.
export async function POST(request) {
  const adminDenied = await requireAdmin(request); if (adminDenied) return adminDenied;
  const denied = await enforce(request);
  if (denied) return denied;
  try {
    const { dedupeMetaDocs } = await import('@/lib/siteMetaServer');
    const result = await dedupeMetaDocs();
    const meta = await getMetaMerged();
    return json({
      data: meta,
      dedupe: { removed: result.removed, kept: String(result.kept ?? '') },
      message: result.removed
        ? `Removed ${result.removed} duplicate Meta doc(s) — kept the latest.`
        : 'No duplicate Meta docs.',
    });
  } catch (error) {
    console.error('[api/meta] POST (dedupe) failed:', error);
    return json({ error: error?.message || 'Failed to dedupe site meta' }, 500);
  }
}
