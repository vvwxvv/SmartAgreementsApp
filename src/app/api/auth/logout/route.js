import { jsonResponse } from "@/app/api/auth/_authUtils";
import { requireAdmin } from "@/lib/requireAdmin";
import { enforce } from "@/app/api/_lib/authz";

function clearAuthCookie() {
  return {
    "Set-Cookie":
      "authToken=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
  };
}

function handleLogout() {
  try {
    return jsonResponse({ message: "Logged out successfully" }, 200, clearAuthCookie());
  } catch (error) {
    console.log("Error during logout:", error);
    return jsonResponse(
      { message: "Failed to log out", error: error.message },
      500
    );
  }
}

// Frontend `authLogin.signOut()` uses POST; GET kept for backwards compat.
// A caller may only end its OWN session; anonymous requests are refused (401).
export async function POST(request) {
  const adminDenied = await requireAdmin(request); if (adminDenied) return adminDenied;
  const denied = await enforce(request);
  if (denied) return denied;
  return handleLogout();
}

export async function GET(request) {
  const adminDenied = await requireAdmin(request); if (adminDenied) return adminDenied;
  const denied = await enforce(request);
  if (denied) return denied;
  return handleLogout();
}