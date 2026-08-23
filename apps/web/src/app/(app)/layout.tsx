import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { auth } from "@leoni/auth";
import { isRole } from "@leoni/core";
import { AppSidebar } from "~/features/shell/app-sidebar";
import { AppTopbar } from "~/features/shell/app-topbar";

/**
 * The authenticated shell.
 *
 * The session is checked here, on the server, before any child renders. The
 * middleware also redirects unauthenticated traffic, but middleware only sees
 * the cookie: this check asks the database, so an account the Administrator
 * deactivated a minute ago cannot keep browsing on a cookie that has not
 * expired yet.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session === null || session.user.isActive === false) {
    redirect("/login");
  }

  // The role arrives from the session store as a plain string. Anything the
  // domain does not recognise is treated as no valid identity rather than being
  // coerced to a default — the same fail-closed rule the API context applies.
  const role =
    typeof session.user.role === "string" && isRole(session.user.role) ? session.user.role : null;

  if (role === null) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-dvh">
      <AppSidebar role={role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar userName={session.user.name} role={role} />

        {/* `min-w-0` above and here is what lets a wide table scroll inside its
            own container instead of stretching the page sideways. */}
        <main className="min-w-0 flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
