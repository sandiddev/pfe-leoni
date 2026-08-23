import type {
  ArticleListItem,
  StockLotItem,
  StockMovementItem,
  ThresholdHistoryPoint,
} from "@leoni/contracts";
import { assessStockItem } from "@leoni/core";
import type { Prisma } from "@leoni/db";

import type { StockItemRow } from "./article.repository";

/**
 * Translation between database rows and the DTOs the client receives.
 *
 * This layer exists for one concrete reason: Prisma returns `Decimal` objects
 * for the threshold and consumption columns, and `Decimal` does not survive
 * serialisation to the browser as a number. Converting in one named place —
 * rather than wherever someone happens to notice — is what stops a threshold
 * arriving in the UI as `{ s: 1, e: 3, d: [1500] }`.
 *
 * It is also where the *computed* fields are attached, so the alert level and
 * the suggested quantity a screen renders are the ones the domain layer
 * produced, not a second implementation living in a component.
 */

/** Prisma `Decimal` (or a plain number) to a JavaScript number. */
function toNumber(value: Prisma.Decimal | number | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

export interface ToListItemOptions {
  readonly row: StockItemRow;
  /** From `ReplenishmentParameter`; drives the warning band. */
  readonly warningMarginRatio: number;
  readonly safetyDays: number;
  readonly extraCoverageDays: number;
}

export function toListItem(options: ToListItemOptions): ArticleListItem {
  const { row, warningMarginRatio, safetyDays, extraCoverageDays } = options;

  const averageDailyConsumption = toNumber(row.averageDailyConsumption);
  const currentStock = row.currentStock;

  // The suggestion is recomputed from the live stock rather than read from a
  // column: `currentStock` changes with every movement, and a stored proposal
  // would be stale the moment a storekeeper records an exit.
  const assessment = assessStockItem({
    currentStock,
    averageDailyConsumption,
    leadTimeDays: row.article.leadTimeDays,
    safetyDays,
    extraCoverageDays,
    vpe: row.article.vpe,
    warningMarginRatio,
  });

  return {
    articleId: row.article.id,
    stockItemId: row.id,
    reference: row.article.reference,
    designation: row.article.designation,
    abcClass: row.article.abcClass,
    vpe: row.article.vpe,
    leadTimeDays: row.article.leadTimeDays,
    isActive: row.article.isActive,

    siteId: row.site.id,
    siteCode: row.site.code,

    currentStock,
    averageDailyConsumption,
    // The stored thresholds are what the last recalculation wrote, and they are
    // what the alert board and the exports must agree on. The freshly computed
    // ones in `assessment` are used only for the suggestion.
    minThreshold: toNumber(row.minThreshold),
    maxThreshold: toNumber(row.maxThreshold),
    safetyStock: toNumber(row.safetyStock),

    alertLevel: row.alertLevel,
    coverageDays: assessment.coverageDays,
    willRunOutBeforeResupply: assessment.willRunOutBeforeResupply,

    isReplenishmentNeeded: assessment.order.isReplenishmentNeeded,
    need: assessment.order.need,
    boxCount: assessment.order.boxCount,
    recommendedQuantity: assessment.order.recommendedQuantity,

    lastRecalculatedAt: row.lastRecalculatedAt,
  };
}

interface LotRow {
  id: string;
  quantity: number;
  fifoDate: Date;
  storageLocation: { code: string };
}

export function toLotItem(row: LotRow): StockLotItem {
  return {
    id: row.id,
    quantity: row.quantity,
    fifoDate: row.fifoDate,
    locationCode: row.storageLocation.code,
  };
}

interface MovementRow {
  id: string;
  type: string;
  quantity: number;
  occurredAt: Date;
  reference: string | null;
  user: { name: string } | null;
}

export function toMovementItem(row: MovementRow): StockMovementItem {
  return {
    id: row.id,
    type: row.type,
    quantity: row.quantity,
    occurredAt: row.occurredAt,
    reference: row.reference,
    userName: row.user?.name ?? null,
  };
}

interface ThresholdHistoryRow {
  computedAt: Date;
  averageDailyConsumption: Prisma.Decimal;
  minThreshold: Prisma.Decimal;
  maxThreshold: Prisma.Decimal;
  safetyStock: Prisma.Decimal;
  trigger: string;
}

export function toThresholdHistoryPoint(row: ThresholdHistoryRow): ThresholdHistoryPoint {
  return {
    computedAt: row.computedAt,
    averageDailyConsumption: toNumber(row.averageDailyConsumption),
    minThreshold: toNumber(row.minThreshold),
    maxThreshold: toNumber(row.maxThreshold),
    safetyStock: toNumber(row.safetyStock),
    trigger: row.trigger,
  };
}
