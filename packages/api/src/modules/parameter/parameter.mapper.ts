import type { ParameterItem, RecalculationHistoryItem } from "@leoni/contracts";
import type { AbcClass } from "@leoni/core";
import { defaultParametersForClass } from "@leoni/core";
import type { Prisma } from "@leoni/db";

import type { parameterRepository } from "./parameter.repository";

/**
 * Rows to the DTOs the parameters screen renders.
 *
 * The one interesting case is a class with no row: it is running on
 * `DEFAULT_CLASS_PARAMETERS`, and the screen has to say so rather than show the
 * numbers as if somebody had chosen them. `isDefault` is that distinction.
 */

type ParameterRow = Awaited<ReturnType<typeof parameterRepository.findParameters>>[number];

export function toParameterItem(row: ParameterRow, abcClass: AbcClass): ParameterItem {
  return {
    abcClass,
    safetyDays: row.safetyDays,
    extraCoverageDays: row.extraCoverageDays,
    averagingWindowDays: row.averagingWindowDays,
    warningMarginRatio: row.warningMarginRatio,
    isDefault: false,
    updatedAt: row.updatedAt,
  };
}

/** What a class runs on before anyone has tuned it. */
export function toDefaultParameterItem(abcClass: AbcClass): ParameterItem {
  const defaults = defaultParametersForClass(abcClass);

  return {
    abcClass,
    safetyDays: defaults.safetyDays,
    extraCoverageDays: defaults.extraCoverageDays,
    averagingWindowDays: defaults.averagingWindowDays,
    warningMarginRatio: defaults.warningMarginRatio,
    isDefault: true,
    updatedAt: null,
  };
}

interface HistoryRow {
  id: string;
  averageDailyConsumption: Prisma.Decimal;
  minThreshold: Prisma.Decimal;
  maxThreshold: Prisma.Decimal;
  safetyStock: Prisma.Decimal;
  trigger: RecalculationHistoryItem["trigger"];
  computedAt: Date;
  stockItem: {
    site: { code: string };
    article: { reference: string; designation: string };
  };
}

export function toHistoryItem(row: HistoryRow): RecalculationHistoryItem {
  return {
    id: row.id,
    reference: row.stockItem.article.reference,
    designation: row.stockItem.article.designation,
    siteCode: row.stockItem.site.code,
    averageDailyConsumption: row.averageDailyConsumption.toNumber(),
    minThreshold: row.minThreshold.toNumber(),
    maxThreshold: row.maxThreshold.toNumber(),
    safetyStock: row.safetyStock.toNumber(),
    trigger: row.trigger,
    computedAt: row.computedAt,
  };
}
