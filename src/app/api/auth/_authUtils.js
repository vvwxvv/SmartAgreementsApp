import jwt from "jsonwebtoken";
import { MongoClient } from "mongodb";

// ─── Shared auth helpers for /api/auth/* routes ───────────────────────────

/**
 * Lazy auth-runtime configuration check. Called BEFORE any auth operation.
 * Builds must succeed WITHOUT auth secrets; a missing/invalid config is refused
 * safely at request time (never defaulted, never skipped).
 */
export function assertAuthConfig() {
  const uri = process.env.MONGODB_URL;
  const dbName = process.env.MONGODB_DB;
  const secret = process.env.JWT_SECRET;
  const missing = [];
  if (!uri) missing.push("MONGODB_URL");
  if (!dbName) missing.push("MONGODB_DB");
  if (!secret) missing.push("JWT_SECRET");
  if (missing.length) {
    const err = new Error("AUTH_UNAVAILABLE");
    err.code = "AUTH_UNAVAILABLE";
    err.missing = missing;
    throw err;
  }
  return { uri, dbName, secret };
}

/** Generic, non-leaking 503 for unconfigured/failed auth. */
export function authUnavailableResponse() {
  return new Response(JSON.stringify({ code: "AUTH_UNAVAILABLE", message: "Authentication is unavailable" }),
    { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export function getSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return secret;
}

/**
 * Extract the JWT from either:
 *   Authorization: Bearer <token>   (header)
 *   authToken=<token>               (cookie)
 * Returns the raw token string, or null if none found.
 */
export function extractToken(req) {
  const header = req.headers.get("authorization") || "";
  const bearer = header.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();

  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)authToken=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);

  return null;
}

/** Verify a JWT; returns the decoded payload or null if invalid/expired. */
export function verifyToken(token) {
  try {
    return jwt.verify(token, getSecretKey());
  } catch {
    return null;
  }
}

// ─── MongoDB (connection pooled per module) ───────────────────────────────

let cachedClient = null;

async function connectDb() {
  const cfg = assertAuthConfig();           // lazily validated per request
  if (cachedClient) return cachedClient.db(cfg.dbName);
  const client = new MongoClient(cfg.uri);
  cachedClient = await client.connect();
  return cachedClient.db(cfg.dbName);
}

/** Fetch a Users document by its string/ObjectId id, or null. */
export async function getUserById(id) {
  const { ObjectId } = await import("mongodb");
  if (!id || !ObjectId.isValid(id)) return null;

  const db = await connectDb();
  return db.collection("Users").findOne({ _id: new ObjectId(id) });
}

/** Shape a stored user document into a client-safe object. */
export function serializeUser(user) {
  if (!user) return null;
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
