import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { ROLES } from "@leoni/core";
import { db } from "@leoni/db";
import { env } from "@leoni/env";

/**
 * Authentication for the LEONI replenishment platform.
 *
 * Two deliberate choices, both following from the brief:
 *
 * 1. There is no self sign-up. Accounts map to real people in two plants, and
 *    the Administrator creates them (section 4). A public registration form
 *    would let anyone with the URL enter the stock system.
 *
 * 2. `role` and `siteId` are stored on the user but are NOT accepted as input.
 *    If they were writable from the sign-in payload, a user could grant
 *    themselves the Administrator role by editing a request body. They are set
 *    only through the administration module, which checks `user:write`.
 *
 * The authorisation rules themselves live in `@leoni/core/access`, not here:
 * who may approve a request is a statement about how LEONI works, not about how
 * sessions are stored.
 */
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],

  emailAndPassword: {
    enabled: true,
    // Accounts are provisioned by the Administrator (section 4).
    disableSignUp: true,
    // The application runs on the LEONI internal network with no mail server
    // guaranteed (section 6.2), so verification is not a precondition of use.
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  user: {
    // No `modelName` override: better-auth's Prisma adapter addresses the
    // client accessor (`db.user`), not the Prisma model name, so naming the
    // model here makes it look for `db.User` and report "User not found".
    additionalFields: {
      role: {
        // A mutable copy: better-auth types this field as `string[]`, and ROLES is
        // a readonly tuple. Spreading satisfies it without asserting anything.
        type: [...ROLES],
        required: true,
        defaultValue: "LTN1_STOREKEEPER",
        input: false,
      },
      siteId: {
        type: "string",
        required: false,
        input: false,
      },
      isActive: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: false,
      },
    },
  },

  session: {
    // A warehouse workstation is shared and rarely locked; a session that
    // outlives the shift is a session someone else inherits.
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,

    // No `cookieCache`. It saved a database round trip per request by trusting
    // the signed cookie for up to five minutes — including the `isActive` flag
    // that `createContext` and the authenticated layout both read. Those two
    // places promise a deactivated account loses access immediately, and with
    // the cache that promise was false for five minutes: five minutes in which
    // a dismissed employee keeps recording stock movements under their own
    // name. `isActive` is an authorisation input, so it is re-read every time.
    // The cost is one indexed primary-key lookup per request.
  },

  advanced: {
    cookiePrefix: "leoni",
    useSecureCookies: env.NODE_ENV === "production",
  },

  // Must be last: lets better-auth set cookies from Next.js server actions.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession["user"];
