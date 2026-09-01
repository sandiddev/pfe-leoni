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
 * The shape follows `ROLES`: a `const` array — iterable, so a screen can map
 * over it and `z.enum()` can validate against it — and a union derived from it.
 * No `isX` guards here: nothing narrows an untrusted string into one of these
 * yet, and an untested guard is worse than an absent one. Add the guard with
 * the caller that needs it.
 */

/** Every way stock can change. Each one writes a StockMovement row. */
export const MOVEMENT_TYPES = [
  "ENTRY",
  "EXIT",
  "ADJUSTMENT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** What caused a threshold recomputation, so a change can be explained later. */
export const RECALCULATION_TRIGGERS = [
  "SCHEDULED",
  "MANUAL",
  "IMPORT",
  "PARAMETER_CHANGE",
] as const;
export type RecalculationTrigger = (typeof RECALCULATION_TRIGGERS)[number];

/**
 * How an article is counted.
 *
 * A *label*, not an arithmetic change: quantities stay whole numbers
 * (`Int` by schema convention), and this says what one of them is a quantity
 * *of*. A catalogue of connector housings is counted in pieces; wire is issued
 * by the metre, and a screen that shows `1 200` without saying `m` is a screen
 * somebody misreads.
 *
 * Expressing fractional quantities — 12,5 m off a reel — would mean making
 * every quantity a `Decimal`, which contradicts the `Never Float` / `Int for
 * quantities` rule the schema conventions enforce. That is a separate decision
 * and has not been taken.
 */
export const MEASUREMENT_UNITS = ["PIECE", "METRE", "KILOGRAM", "LITRE"] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

/** Urgency declared by the requester. */
export const REQUEST_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

/** LTN1 consumes, LTN4 supplies. The direction of every transfer follows. */
export const SITE_TYPES = ["CONSUMING", "SUPPLYING"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

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
