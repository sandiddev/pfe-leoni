import { TRPCError } from "@trpc/server";

import { canAccessSite, isCrossSiteRole } from "@leoni/core";

import type { Actor } from "../context";

/**
 * Site scoping (brief section 4).
 *
 * A user belongs to exactly one plant; the Administrator and the Logistics
 * Manager span both. Every query that reads plant data goes through one of the
 * two helpers below, so the rule is applied in one place rather than
 * remembered at each call site.
 *
 * The important property is that scoping is *not* a filter the client sends.
 * A request may ask for a site, but what it receives is the intersection of
 * that ask with what the actor is allowed to see — which is why
 * `resolveSiteFilter` returns the effective site rather than validating the
 * requested one and passing it through.
 */

/**
 * The site a query should actually be restricted to.
 *
 * Returns `null` to mean "no restriction", which only ever happens for a
 * cross-site role that did not ask for a specific plant.
 */
export function resolveSiteFilter(
  actor: Actor,
  requestedSiteId: string | undefined,
): string | null {
  if (isCrossSiteRole(actor.role)) {
    // Cross-site roles may narrow to one plant, or see everything.
    return requestedSiteId ?? null;
  }

  if (actor.siteId === null) {
    // A single-site account with no plant assigned is misconfigured. Failing
    // closed means it sees nothing, rather than everything.
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Aucun site n est associe a votre compte. Contactez l administrateur.",
    });
  }

  if (requestedSiteId !== undefined && requestedSiteId !== actor.siteId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Vous ne pouvez consulter que les donnees de votre site.",
    });
  }

  return actor.siteId;
}

/**
 * Guards access to a specific record once its plant is known.
 *
 * Used after a lookup by id: a filter cannot protect a `findUnique`, so the
 * check happens on the row that came back. Without this, an LTN4 user could
 * read an LTN1 stock item simply by guessing its identifier.
 */
export function assertCanAccessSite(actor: Actor, targetSiteId: string): void {
  if (!canAccessSite(actor.role, actor.siteId, targetSiteId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Vous ne pouvez pas acceder aux donnees de ce site.",
    });
  }
}
