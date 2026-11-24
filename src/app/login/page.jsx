// The single-pattern login page is retired: the admin gate at /admin/login
// (two gestures, hashed in the database) is the only entry point. This route is
// kept as a redirect so old bookmarks do not land on a page that can no longer
// authenticate (it used to POST to an endpoint that requires an admin cookie).
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyLoginPage() {
  redirect("/admin/login");
}
