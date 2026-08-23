import { redirect } from "next/navigation";

/**
 * The root path has no screen of its own. Signed-in users belong on the
 * dashboard; the shell redirects anyone else to the login page.
 */
export default function RootPage() {
  redirect("/tableau-de-bord");
}
