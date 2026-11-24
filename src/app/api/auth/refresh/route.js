import jwt from "jsonwebtoken";
import { requireAdmin } from "@/lib/requireAdmin";
import {
  getSecretKey,
  extractToken,
  verifyToken,
  jsonResponse,
} from "@/app/api/auth/_authUtils";
import { enforce } from "@/app/api/_lib/authz";

/**
 * POST /api/auth/refresh
 * Exchanges a valid token for a fresh one (1h). Frontend
 * `authLogin.renewToken()` relies on this.
 */
export async function POST(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const denied = await enforce(req);   // must present a valid refresh credential
  if (denied) return denied;
  const token = extractToken(req);
  if (!token) {
    return jsonResponse({ message: "No token provided" }, 401);
  }

  const payload = verifyToken(token);
  if (!payload) {
    return jsonResponse({ message: "Invalid or expired token" }, 401);
  }

  // Issue a new token with the same identity, without inherited iat/exp.
  const freshToken = jwt.sign(
    {
      id: payload.id,
      email: payload.email,
      role: payload.role,
    },
    getSecretKey(),
    { expiresIn: "1h" }
  );

  return jsonResponse({ message: "Token refreshed", token: freshToken }, 200);
}
