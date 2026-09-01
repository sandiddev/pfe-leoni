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

/**
 * Consumed quantity per article over the window, for the Pareto ranking.
 *
 * Deliberately *not* filtered by the run's site. `abcClass` is a column on
 * `Article`, shared by both plants, so a classification computed from one
 * site's movements would flip an article's class depending on who happened to
 * run the recalculation. Only `EXIT` counts as consumption — the same rule
 * `findConsumptionSamples` applies — so in practice this is demand at the
 * consuming plant, which is the only place production draws stock.
 *
 * Every active article is returned, including those with no movement at all: a
 * Pareto needs the whole population to divide, and an article absent from the
 * ranking would keep a class nothing justifies. `classifyAbc` puts a catalogue
 * with no consumption entirely in class C.
 */
export async function findConsumptionByArticle(
  since: Date,
): Promise<readonly { articleId: string; consumptionValue: number }[]> {
  const items = await db.stockItem.findMany({
    where: { article: { isActive: true } },
    select: { id: true, articleId: true },
  });

  const consumed = await db.stockMovement.groupBy({
    by: ["stockItemId"],
    where: {
      type: "EXIT",
      occurredAt: { gte: since },
      stockItemId: { in: items.map((item) => item.id) },
    },
    _sum: { quantity: true },
  });

  const quantityByStockItem = new Map(
    consumed.map((row) => [row.stockItemId, row._sum.quantity ?? 0]),
  );

  // Summed across sites per article, because the class is one article-level
  // fact and an article may be stocked at both plants.
  const totals = new Map<string, number>();
  for (const item of items) {
    const previous = totals.get(item.articleId) ?? 0;
    totals.set(item.articleId, previous + (quantityByStockItem.get(item.id) ?? 0));
  }

  return [...totals].map(([articleId, consumptionValue]) => ({ articleId, consumptionValue }));
}

/** One article moving class, as the domain decided it. */
export interface AbcClassWrite {
  readonly articleId: string;
  readonly abcClass: AbcClass;
  /** Written in the same transaction as the column, never a second call. */
  readonly audit: AuditEntry;
}

/**
 * Moves articles to the classes the Pareto pass computed.
 *
 * One transaction per article, matching `applyThresholdWithHistory`: the unit
 * that has to be consistent is an article and the row explaining why its class
 * changed. A single transaction over the catalogue would hold locks across
 * every screen for the length of the run.
 *
 * `abcClass` decides which parameters govern the article, so a class that moved
 * without an audit row is a threshold nobody can trace back to a cause — which
 * is why the `AuditLog` write is part of this method rather than left to the
 * caller.
 */
export async function applyAbcClasses(writes: readonly AbcClassWrite[]): Promise<void> {
  for (const write of writes) {
    await db.$transaction([
      db.article.update({
        where: { id: write.articleId },
        data: { abcClass: write.abcClass },
      }),
      db.auditLog.create({
        data: {
          entity: write.audit.entity,
          entityId: write.audit.entityId,
          action: write.audit.action,
          before: write.audit.before ?? { equals: null },
          after: write.audit.after ?? { equals: null },
          actorId: write.audit.actorId,
        },
      }),
    ]);
  }
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
  findConsumptionByArticle,
  applyAbcClasses,
  applyThresholdWithHistory,
  findRecalculationHistory,
};

export type ParameterRepository = typeof parameterRepository;
