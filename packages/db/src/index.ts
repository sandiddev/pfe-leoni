/**
 * `@leoni/db` — persistence.
 *
 * This package exposes the Prisma client and the generated types, and nothing
 * else: no queries, no business rules. Queries live in the repository layer of
 * `@leoni/api`, which is the only place allowed to import this package. That
 * rule is enforced by lint, and it is what keeps SQL out of the services and
 * the services testable.
 */

export { db } from "./client";

export { Prisma } from "./generated/prisma/client";
export type { PrismaClient } from "./generated/prisma/client";

/**
 * Enumerations, re-exported so the rest of the workspace never reaches into the
 * generated folder. They mirror the union types in `@leoni/core` exactly; the
 * test alongside this file fails the build if the two ever drift.
 */
export {
  AbcClass,
  AlertLevel,
  MeasurementUnit,
  MovementType,
  NotificationType,
  RecalculationTrigger,
  RequestPriority,
  RequestStatus,
  Role,
  SiteType,
} from "./generated/prisma/enums";

/** Row types, for repository signatures and mappers. */
export type {
  Account,
  Article,
  AuditLog,
  Notification,
  ReplenishmentParameter,
  ReplenishmentRequest,
  ReplenishmentRequestLine,
  RequestAttachment,
  RequestComment,
  RequestStatusHistory,
  Session,
  Site,
  StockAlertSnapshot,
  StockItem,
  StockLot,
  StockMovement,
  StorageLocation,
  ThresholdHistory,
  User,
  Verification,
} from "./generated/prisma/client";
