import type { AbcClass, AlertLevel, RecalculationTrigger } from "@leoni/core";
import type { Prisma } from "@leoni/db";
import { db } from "@leoni/db";

import type { AuditEntry } from "../../shared/audit";

/**
 * Persistence for the tuning parameters and the threshold recalculation.
 *
 * Two audited writes live here. A parameter edit lands with its `AuditLog` row,
 * and a recomputed threshold lands with its `ThresholdHistory` row — the latter
 * carrying the exact inputs it was computed from, frozen as JSON, because the
 * parameter row it came from will itself change and a foreign key would make
 * the history lie the moment someone edits a default.
 */

export async function findParameters() {
  return db.replenishmentParameter.findMany({
    where: { abcClass: { not: null } },
    select: {
      id: true,
      abcClass: true,
      safetyDays: true,
      extraCoverageDays: true,
      averagingWindowDays: true,
      warningMarginRatio: true,
      updatedAt: true,
    },
    orderBy: { abcClass: "asc" },
  });
}

export interface ParameterData {
  readonly safetyDays: number;
  readonly extraCoverageDays: number;
  readonly averagingWindowDays: number;
  readonly warningMarginRatio: number;
}

export interface UpsertParameterOptions {
  readonly abcClass: AbcClass;
  readonly data: ParameterData;
  /** Built by the service. Written in the same transaction as the row. */
  readonly audit: AuditEntry;
}

/**
 * Writes a class's parameters and records the change, atomically.
 *
 * An upsert rather than an update: a class with no row yet is running on
 * `DEFAULT_CLASS_PARAMETERS`, and the first edit is the one that materialises
 * it. Splitting that into "does it exist?" then "write it" would race two
 * administrators into a unique-constraint failure.
 */
export async function upsertWithAudit(options: UpsertParameterOptions): Promise<void> {
  const { abcClass, data, audit } = options;

  await db.$transaction([
    db.replenishmentParameter.upsert({
      where: { abcClass },
      create: { abcClass, ...data },
      update: data,
    }),
    db.auditLog.create({
      data: {
        entity: audit.entity,
        entityId: audit.entityId,
        action: audit.action,
        before: audit.before ?? { equals: null },
        after: audit.after ?? { equals: null },
        actorId: audit.actorId,
      },
    }),
  ]);
}

/**
 * The override written for one article, if any.
 *
 * `ReplenishmentParameter` carries either an `abcClass` or an `articleId`,
 * never both, and both columns are unique — so this is a single-row lookup.
 */
export async function findParameterForArticle(articleId: string) {
  return db.replenishmentParameter.findUnique({
    where: { articleId },
    select: {
      id: true,
      safetyDays: true,
      extraCoverageDays: true,
      averagingWindowDays: true,
      warningMarginRatio: true,
      updatedAt: true,
    },
  });
}

export async function findArticleForOverride(articleId: string) {
  return db.article.findUnique({
    where: { id: articleId },
    select: { id: true, reference: true, abcClass: true },
  });
}

export interface UpsertArticleParameterOptions {
  readonly articleId: string;
  readonly data: ParameterData;
  readonly audit: AuditEntry;
}

/** Writes an article's own parameters, and records who chose them. */
export async function upsertArticleParameterWithAudit(
  options: UpsertArticleParameterOptions,
): Promise<void> {
  await db.$transaction([
    db.replenishmentParameter.upsert({
      where: { articleId: options.articleId },
      create: { articleId: options.articleId, ...options.data },
      update: options.data,
    }),
    db.auditLog.create({ data: auditData(options.audit) }),
  ]);
}

/** Drops an override so the article falls back to its class defaults. */
export async function clearArticleParameterWithAudit(options: {
  readonly articleId: string;
  readonly audit: AuditEntry;
}): Promise<void> {
  await db.$transaction([
    db.replenishmentParameter.deleteMany({ where: { articleId: options.articleId } }),
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

/** Every stock item a recalculation run covers, with what it needs to compute. */
export async function findRecalculationTargets(siteId: string | null, abcClass: AbcClass | null) {
  return db.stockItem.findMany({
    where: {
      article: { isActive: true, ...(abcClass === null ? {} : { abcClass }) },
      ...(siteId === null ? {} : { siteId }),
    },
    select: {
      id: true,
      currentStock: true,
      minThreshold: true,
      maxThreshold: true,
      safetyStock: true,
      alertLevel: true,
      article: {
        select: {
          id: true,
          leadTimeDays: true,
          abcClass: true,
          // The article's own parameters, if somebody wrote them. Selected
          // with the target rather than looked up per row: a recalculation
          // covers the whole catalogue, and one query per article would make
          // the run quadratic in the number of references.
          parameter: {
            select: {
              safetyDays: true,
              extraCoverageDays: true,
              averagingWindowDays: true,
              warningMarginRatio: true,
            },
          },
        },
      },
    },
  });
}

/**
 * The outbound movements every average is computed from, in one query.
 *
 * Only `EXIT` counts as consumption: a transfer to the other plant leaves the
 * store but is not demand from the line, and an inventory correction is not
 * demand at all. `isConsumption` in the domain states the same rule; this
 * filter is its SQL twin, and the domain remains the place it is decided.
 */
export async function findConsumptionSamples(stockItemIds: readonly string[], since: Date) {
  return db.stockMovement.findMany({
    where: { stockItemId: { in: [...stockItemIds] }, type: "EXIT", occurredAt: { gte: since } },
    select: { stockItemId: true, quantity: true, occurredAt: true },
  });
}

/** One stock item's recomputed figures, decided by the domain. */
export interface ThresholdWrite {
  readonly stockItemId: string;
  readonly averageDailyConsumption: number;
  readonly minThreshold: number;
  readonly maxThreshold: number;
  readonly safetyStock: number;
  readonly alertLevel: AlertLevel;
  /** The exact inputs used, frozen so the history cannot be rewritten. */
  readonly parametersSnapshot: Prisma.InputJsonValue;
  readonly trigger: RecalculationTrigger;
  readonly computedById: string | null;
  readonly computedAt: Date;
}

/**
 * Writes one item's new thresholds and the row that explains them, atomically.
 *
 * Section 3.5 requires that a threshold change can be explained afterwards, and
 * a stored figure whose history row failed to write is a number nobody can
 * account for. One transaction per item rather than one for the whole run: the
 * granularity that matters is the article, and a single transaction over a
 * thousand rows would hold locks across the entire catalogue.
 */
export async function applyThresholdWithHistory(write: ThresholdWrite): Promise<void> {
  await db.$transaction([
    db.stockItem.update({
      where: { id: write.stockItemId },
      data: {
        averageDailyConsumption: write.averageDailyConsumption,
        minThreshold: write.minThreshold,
        maxThreshold: write.maxThreshold,
        safetyStock: write.safetyStock,
        alertLevel: write.alertLevel,
        lastRecalculatedAt: write.computedAt,
      },
    }),
    db.thresholdHistory.create({
      data: {
        stockItemId: write.stockItemId,
        averageDailyConsumption: write.averageDailyConsumption,
        minThreshold: write.minThreshold,
        maxThreshold: write.maxThreshold,
        safetyStock: write.safetyStock,
        parametersSnapshot: write.parametersSnapshot,
        trigger: write.trigger,
        computedById: write.computedById,
        computedAt: write.computedAt,
      },
    }),
  ]);
}

export async function findRecalculationHistory(siteId: string | null, limit: number) {
  return db.thresholdHistory.findMany({
    where: siteId === null ? {} : { stockItem: { siteId } },
    select: {
      id: true,
      averageDailyConsumption: true,
      minThreshold: true,
      maxThreshold: true,
      safetyStock: true,
      trigger: true,
      computedAt: true,
      stockItem: {
        select: {
          site: { select: { code: true } },
          article: { select: { reference: true, designation: true } },
        },
      },
    },
    orderBy: { computedAt: "desc" },
    take: limit,
  });
}

export const parameterRepository = {
  findParameters,
  findParameterForArticle,
  findArticleForOverride,
  upsertArticleParameterWithAudit,
  clearArticleParameterWithAudit,
  upsertWithAudit,
  findRecalculationTargets,
  findConsumptionSamples,
  applyThresholdWithHistory,
  findRecalculationHistory,
};

export type ParameterRepository = typeof parameterRepository;
