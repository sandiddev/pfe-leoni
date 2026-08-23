import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { Auth } from "./server";

/**
 * Browser-side authentication client.
 *
 * `inferAdditionalFields<Auth>()` carries the server's extra user columns —
 * `role`, `siteId`, `isActive` — through to the client types, so a component
 * reading `session.user.role` gets the real union rather than `string`. Without
 * it, every role check in the UI would be an untyped string comparison.
 */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>()],
});

export const { signIn, signOut, useSession, getSession } = authClient;
