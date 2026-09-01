import type { SiteType } from "@leoni/core";
import type { Prisma } from "@leoni/db";
import { db } from "@leoni/db";

import type { AuditEntry } from "../../shared/audit";

/**
 * Persistence for plant master data.
 *
 * Both entities are audited: a shelf that disappears takes the explanation of
 * where its stock went with it, and a site whose type flips reverses the
 * direction of every future transfer. Neither should be possible to do
 * anonymously.
 */

const siteSelection = {
  id: true,
  code: true,
  name: true,
  type: true,
  _count: { select: { storageLocations: true, requestsFrom: true, requestsTo: true } },
} satisfies Prisma.SiteSelect;

export type SiteRow = Prisma.SiteGetPayload<{ select: typeof siteSelection }>;

const locationSelection = {
  id: true,
  code: true,
  description: true,
  siteId: true,
  site: { select: { code: true } },
  lots: { where: { quantity: { gt: 0 } }, select: { quantity: true } },
} satisfies Prisma.StorageLocationSelect;

export type LocationRow = Prisma.StorageLocationGetPayload<{ select: typeof locationSelection }>;

export async function findSites(): Promise<SiteRow[]> {
  return db.site.findMany({ select: siteSelection, orderBy: { code: "asc" } });
}

export async function findSiteByCode(code: string) {
  return db.site.findUnique({ where: { code }, select: { id: true } });
}

export async function findSiteById(siteId: string) {
  return db.site.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      _count: { select: { requestsFrom: true, requestsTo: true } },
    },
  });
}

export interface SiteData {
  readonly code: string;
  readonly name: string;
  readonly type: SiteType;
}

export interface CreateSiteOptions {
  readonly siteId: string;
  readonly data: SiteData;
  readonly audit: AuditEntry;
}

export async function createSiteWithAudit(options: CreateSiteOptions): Promise<void> {
  await db.$transaction([
    db.site.create({ data: { id: options.siteId, ...options.data } }),
    db.auditLog.create({ data: auditData(options.audit) }),
  ]);
}

export interface UpdateSiteOptions {
  readonly siteId: string;
  readonly data: { readonly name: string; readonly type: SiteType };
  readonly audit: AuditEntry;
}

export async function updateSiteWithAudit(options: UpdateSiteOptions): Promise<void> {
  await db.$transaction([
    db.site.update({ where: { id: options.siteId }, data: options.data }),
    db.auditLog.create({ data: auditData(options.audit) }),
  ]);
}

export async function findLocations(siteId: string | null): Promise<LocationRow[]> {
  return db.storageLocation.findMany({
    where: siteId === null ? {} : { siteId },
    select: locationSelection,
    orderBy: [{ site: { code: "asc" } }, { code: "asc" }],
  });
}

export async function findLocationById(storageLocationId: string) {
  return db.storageLocation.findUnique({
    where: { id: storageLocationId },
    select: {
      id: true,
      code: true,
      description: true,
      siteId: true,
      // Every lot, not only the non-empty ones. The delete guard has to match
      // what the foreign key actually enforces, and `stock_lot_storageLocationId_fkey`
      // does not care whether a lot has anything left in it. Filtering on
      // `quantity > 0` here let an exhausted lot pass the check and fail at the
      // database — which the smoke test found on its first run.
      lots: { select: { quantity: true } },
    },
  });
}

/** The schema's `@@unique([siteId, code])`, checked before Postgres refuses. */
export async function findLocationByCode(siteId: string, code: string) {
  return db.storageLocation.findFirst({ where: { siteId, code }, select: { id: true } });
}

export interface LocationData {
  readonly code: string;
  readonly description: string | null;
}

export interface CreateLocationOptions {
  readonly storageLocationId: string;
  readonly siteId: string;
  readonly data: LocationData;
  readonly audit: AuditEntry;
}

export async function createLocationWithAudit(options: CreateLocationOptions): Promise<void> {
  await db.$transaction([
    db.storageLocation.create({
      data: { id: options.storageLocationId, siteId: options.siteId, ...options.data },
    }),
    db.auditLog.create({ data: auditData(options.audit) }),
  ]);
}

export interface UpdateLocationOptions {
  readonly storageLocationId: string;
  readonly data: LocationData;
  readonly audit: AuditEntry;
}

export async function updateLocationWithAudit(options: UpdateLocationOptions): Promise<void> {
  await db.$transaction([
    db.storageLocation.update({ where: { id: options.storageLocationId }, data: options.data }),
    db.auditLog.create({ data: auditData(options.audit) }),
  ]);
}

/**
 * Removes an empty shelf, and records that it existed.
 *
 * The audit row is the whole reason this is a transaction: once the location is
 * gone, the only remaining evidence that it was ever there is the entry saying
 * who removed it and what it was called.
 */
export interface DeleteLocationOptions {
  readonly storageLocationId: string;
  readonly audit: AuditEntry;
}

export async function deleteLocationWithAudit(options: DeleteLocationOptions): Promise<void> {
  await db.$transaction([
    db.storageLocation.delete({ where: { id: options.storageLocationId } }),
    db.auditLog.create({ data: auditData(options.audit) }),
  ]);
}

/** Nullable Json columns need Prisma's explicit null, not a bare `null`. */
function auditData(audit: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
  return {
    entity: audit.entity,
    entityId: audit.entityId,
    action: audit.action,
    before: audit.before ?? { equals: null },
    after: audit.after ?? { equals: null },
    actorId: audit.actorId,
  };
}

export const referentialRepository = {
  findSites,
  findSiteById,
  findSiteByCode,
  createSiteWithAudit,
  updateSiteWithAudit,
  findLocations,
  findLocationById,
  findLocationByCode,
  createLocationWithAudit,
  updateLocationWithAudit,
  deleteLocationWithAudit,
};

export type ReferentialRepository = typeof referentialRepository;
