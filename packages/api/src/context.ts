import { auth } from "@leoni/auth";
import { isRole, type Role } from "@leoni/core";
import { db } from "@leoni/db";

/**
 * What every procedure is given.
 *
 * The `actor` is the flattened, already-validated identity of the caller. It is
 * built once here rather than re-derived from the session in each procedure,
 * because "who is asking, in which role, at which plant" is the question every
 * authorisation rule in the application depends on, and three slightly
 * different derivations of it would be three slightly different security
 * models.
 */
export interface Actor {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  /** `null` for ADMIN and LOGISTICS_MANAGER, who span both plants. */
  readonly siteId: string | null;
}

export interface Context {
  readonly db: typeof db;
  readonly actor: Actor | null;
  /** Correlates every log line and audit row written while handling one call. */
  readonly requestId: string;
  readonly headers: Headers;
}

export interface CreateContextOptions {
  readonly headers: Headers;
}

/**
 * Builds the context for one request.
 *
 * A session whose user has been deactivated is treated as no session at all:
 * the Administrator disables an account rather than deleting it (so the audit
 * trail keeps a resolvable author), and that must take effect immediately
 * rather than when the cookie happens to expire.
 */
export async function createContext(options: CreateContextOptions): Promise<Context> {
  const session = await auth.api.getSession({ headers: options.headers });

  const requestId = crypto.randomUUID();
  const user = session?.user;

  if (user === undefined || user.isActive === false) {
    return { db, actor: null, requestId, headers: options.headers };
  }

  // The role arrives as a string from the session store. Anything unrecognised
  // is treated as no identity rather than being coerced to a default: failing
  // closed is the only safe direction for an authorisation input.
  const role = typeof user.role === "string" && isRole(user.role) ? user.role : null;

  if (role === null) {
    return { db, actor: null, requestId, headers: options.headers };
  }

  return {
    db,
    requestId,
    headers: options.headers,
    actor: {
      userId: user.id,
      name: user.name,
      email: user.email,
      role,
      siteId: typeof user.siteId === "string" ? user.siteId : null,
    },
  };
}
