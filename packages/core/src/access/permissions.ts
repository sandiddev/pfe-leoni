import { ForbiddenActionError } from "../errors/domain-error";
import { type Permission, PERMISSIONS } from "./permission";
import type { Role } from "./role";

/**
 * Role to permission matrix (brief section 4).
 *
 * This lives in the domain package rather than in `@leoni/auth` on purpose: it
 * is a statement about how LEONI's process is organised, not about how sessions
 * are stored. Keeping it here means the whole authorisation model is unit
 * tested without a database, and swapping the authentication library later
 * would not put a single business rule at risk.
 */

/** The Administrator holds every permission by construction, not by a list to maintain. */
const ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS;

/**
 * Reads everything across both sites, writes nothing.
 * This is the Logistics Manager's whole mandate: steer with the numbers, do not
 * touch the flow.
 */
const LOGISTICS_MANAGER_PERMISSIONS: readonly Permission[] = [
  "article:read",
  "stock:read",
  "alert:read",
  "request:read",
  "parameter:read",
  "dashboard:read",
  "report:export",
  "audit:read",
];

/** Works the LTN1 store: records movements, raises and receives requests. */
const LTN1_STOREKEEPER_PERMISSIONS: readonly Permission[] = [
  "article:read",
  "stock:read",
  "stock:move",
  "alert:read",
  "request:read",
  "request:create",
  "request:receive",
  "request:close",
  "request:cancel",
  "request:comment",
  "parameter:read",
  "dashboard:read",
  "report:export",
];

/** Gatekeeper for LTN1: approves, adjusts quantities, transmits to LTN4. */
const LTN1_WAREHOUSE_MANAGER_PERMISSIONS: readonly Permission[] = [
  "article:read",
  "stock:read",
  "alert:read",
  "request:read",
  "request:create",
  "request:approve",
  "request:transmit",
  "request:close",
  "request:cancel",
  "request:comment",
  "parameter:read",
  "threshold:recalculate",
  "dashboard:read",
  "report:export",
];

/** Fulfils from LTN4: prepares, ships, declares shortages. */
const LTN4_RESPONSIBLE_PERMISSIONS: readonly Permission[] = [
  "article:read",
  "stock:read",
  "stock:move",
  "alert:read",
  "request:read",
  "request:prepare",
  "request:ship",
  "request:comment",
  "dashboard:read",
  "report:export",
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  ADMIN: ADMIN_PERMISSIONS,
  LTN1_STOREKEEPER: LTN1_STOREKEEPER_PERMISSIONS,
  LTN1_WAREHOUSE_MANAGER: LTN1_WAREHOUSE_MANAGER_PERMISSIONS,
  LTN4_RESPONSIBLE: LTN4_RESPONSIBLE_PERMISSIONS,
  LOGISTICS_MANAGER: LOGISTICS_MANAGER_PERMISSIONS,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAll(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => can(role, permission));
}

export function canAny(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

/** Throwing variant for the service layer. */
export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new ForbiddenActionError(`The role ${role} does not hold the permission ${permission}.`, {
      role,
      permission,
    });
  }
}

/**
 * Whether `role` may act on data belonging to `siteId`.
 *
 * Site scoping is enforced here and applied by a tRPC middleware on every
 * query, so an LTN4 user cannot read LTN1's stock by guessing an id.
 */
export function canAccessSite(
  role: Role,
  userSiteId: string | null,
  targetSiteId: string,
): boolean {
  if (role === "ADMIN" || role === "LOGISTICS_MANAGER") return true;
  return userSiteId !== null && userSiteId === targetSiteId;
}
