import { requireAdmin } from "@/lib/requireAdmin";
import {
  extractToken,
  verifyToken,
  getUserById,
  serializeUser,
  jsonResponse,
} from "@/app/api/auth/_authUtils";
import { enforce } from "@/app/api/_lib/authz";

/**
 * GET /api/auth/verify
 * Validates the bearer token (header or authToken cookie) and returns the
 * current user. Frontend `authLogin.checkLoginStatus()` relies on this.
 */
export async function GET(req) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const denied = await enforce(req);   // reachable without a session, but MUST validate the token
  if (denied) return denied;
  const token = extractToken(req);
  if (!token) {
    return jsonResponse({ message: "No token provided" }, 401);
  }

  const payload = verifyToken(token);
  if (!payload) {
    return jsonResponse({ message: "Invalid or expired token" }, 401);
  }

  // Return fresh user data from the DB; fall back to the token payload.
  const storedUser = await getUserById(payload.id);
  if (storedUser) {
    return jsonResponse({ user: serializeUser(storedUser) }, 200);
  }

  return jsonResponse(
    {
      user: {
        id: payload.id,
        email: payload.email,
        role: payload.role,
      },
    },
    200
  );
}
