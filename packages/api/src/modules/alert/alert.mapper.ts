import type { AlertBoardItem } from "@leoni/contracts";
import { assessStockItem } from "@leoni/core";

import type { AlertRow } from "./alert.repository";

/**
 * A stock row to a board row.
 *
 * Deliberately a near-copy of `article.mapper.ts#toListItem` rather than an
 * import of it: a module that reaches into another module's mapper couples two
 * features through their private layers, and the next change to the article
 * screen would silently move the alert board. The shared part that genuinely
 * must not be duplicated — the arithmetic — is `assessStockItem`, and both call
 * it.
 */

export interface ToBoardItemOptions {
  readonly row: AlertRow;
  readonly safetyDays: number;
  readonly extraCoverageDays: number;
  readonly warningMarginRatio: number;
}

export function toBoardItem(options: ToBoardItemOptions): AlertBoardItem {
  const { row, safetyDays, extraCoverageDays, warningMarginRatio } = options;

  const averageDailyConsumption = row.averageDailyConsumption.toNumber();

  // Recomputed from the live stock rather than read from a column: a stored
  // proposal is stale the moment a storekeeper records an exit.
  const assessment = assessStockItem({
    currentStock: row.currentStock,
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
    unit: row.article.unit,
    vpe: row.article.vpe,
    leadTimeDays: row.article.leadTimeDays,
    isActive: row.article.isActive,

    siteId: row.site.id,
    siteCode: row.site.code,

    currentStock: row.currentStock,
    averageDailyConsumption,
    minThreshold: row.minThreshold.toNumber(),
    maxThreshold: row.maxThreshold.toNumber(),
    safetyStock: row.safetyStock.toNumber(),

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
