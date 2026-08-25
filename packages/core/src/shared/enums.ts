/**
 * Domain vocabulary the database also stores.
 *
 * Each set below mirrors a Prisma enum exactly, and `enum-parity.test.ts` in
 * `@leoni/db` fails the build if the two ever drift. They live here — not in
 * `@leoni/db` — because what a movement type or a notification *means* is a
 * statement about how LEONI works, while how it is stored is the database's
 * concern. Keeping them here is also what lets `@leoni/contracts` type a DTO
 * field with the real union: contracts may not import the generated Prisma
 * client, so a DTO that needed one of these was previously widened to `string`,
 * which forced a cast at the first component that rendered its French label.
 *
 * The shape follows `ROLES`: a `const` array (iterable, so a screen can map
 * over it), a union derived from it, and a guard for narrowing an untrusted
 * string at a boundary.
 */

/** Every way stock can change. Each one writes a StockMovement row. */
export const MOVEMENT_TYPES = ["ENTRY", "EXIT", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export function isMovementType(value: string): value is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(value);
}

/** What caused a threshold recomputation, so a change can be explained later. */
export const RECALCULATION_TRIGGERS = ["SCHEDULED", "MANUAL", "IMPORT", "PARAMETER_CHANGE"] as const;
export type RecalculationTrigger = (typeof RECALCULATION_TRIGGERS)[number];

export function isRecalculationTrigger(value: string): value is RecalculationTrigger {
  return (RECALCULATION_TRIGGERS as readonly string[]).includes(value);
}

/** Urgency declared by the requester. */
export const REQUEST_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

export function isRequestPriority(value: string): value is RequestPriority {
  return (REQUEST_PRIORITIES as readonly string[]).includes(value);
}

/** LTN1 consumes, LTN4 supplies. The direction of every transfer follows. */
export const SITE_TYPES = ["CONSUMING", "SUPPLYING"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export function isSiteType(value: string): value is SiteType {
  return (SITE_TYPES as readonly string[]).includes(value);
}

/** Events the notification centre can raise. */
export const NOTIFICATION_TYPES = [
  "STOCK_CRITICAL",
  "STOCK_RUPTURE",
  "REQUEST_CREATED",
  "REQUEST_APPROVED",
  "REQUEST_REJECTED",
  "REQUEST_SHIPPED",
  "REQUEST_RECEIVED",
  "REQUEST_LATE",
  "LTN4_STOCK_OUT",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}
