/**
 * The vocabulary of authorisation.
 *
 * Permissions are named after *what the business allows*, not after screens or
 * routes. `request:approve` survives a redesign of the interface; `canSeeButton`
 * does not. Every tRPC procedure declares the permission it needs, so the answer
 * to "who can approve a request?" is one grep away rather than a reading of the
 * whole router.
 */
export const PERMISSIONS = [
  // Article master data
  "article:read",
  "article:write",
  "article:import",

  // Stock and movements
  "stock:read",
  "stock:move",
  "stock:adjust",

  // Alerts
  "alert:read",

  // Replenishment requests
  "request:read",
  "request:create",
  "request:approve",
  "request:transmit",
  "request:prepare",
  "request:ship",
  "request:receive",
  "request:close",
  "request:cancel",
  "request:comment",

  // Replenishment parameters and thresholds
  "parameter:read",
  "parameter:write",
  "threshold:recalculate",

  // Decision support
  "dashboard:read",
  "report:export",

  // Administration
  "user:read",
  "user:write",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
