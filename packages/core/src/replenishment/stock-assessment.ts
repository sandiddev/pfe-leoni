import { type AlertLevel, resolveAlertLevel } from "./alert-level";
import { daysOfCoverage } from "./coverage";
import { computeOrderQuantity, type OrderQuantity } from "./order-quantity";
import { computeThresholds, type Thresholds } from "./thresholds";

/**
 * The single entry point the application layer calls per stock item.
 *
 * Detecting the need, deciding the severity and proposing the quantity are one
 * indivisible act of reasoning about one article: splitting them across three
 * call sites in the service layer would let them be called with inconsistent
 * inputs (thresholds from one recalculation, stock from another). Composing
 * them here keeps the whole assessment atomic and makes the alert board a
 * straight `map` over this function.
 */
export interface StockAssessmentInputs {
  readonly currentStock: number;
  readonly averageDailyConsumption: number;
  readonly leadTimeDays: number;
  readonly safetyDays: number;
  readonly extraCoverageDays: number;
  readonly vpe: number;
  readonly warningMarginRatio?: number;
}

export interface StockAssessment {
  readonly thresholds: Thresholds;
  readonly alertLevel: AlertLevel;
  /** `null` when the article has no measured consumption. */
  readonly coverageDays: number | null;
  /** True when coverage is shorter than LTN4's lead time. */
  readonly willRunOutBeforeResupply: boolean;
  readonly order: OrderQuantity;
}

export function assessStockItem(inputs: StockAssessmentInputs): StockAssessment {
  const thresholds = computeThresholds({
    averageDailyConsumption: inputs.averageDailyConsumption,
    leadTimeDays: inputs.leadTimeDays,
    safetyDays: inputs.safetyDays,
    extraCoverageDays: inputs.extraCoverageDays,
  });

  const alertLevel = resolveAlertLevel({
    currentStock: inputs.currentStock,
    min: thresholds.min,
    ...(inputs.warningMarginRatio === undefined
      ? {}
      : { warningMarginRatio: inputs.warningMarginRatio }),
  });

  const coverageDays = daysOfCoverage(inputs.currentStock, inputs.averageDailyConsumption);

  const order = computeOrderQuantity({
    currentStock: inputs.currentStock,
    min: thresholds.min,
    max: thresholds.max,
    vpe: inputs.vpe,
  });

  return {
    thresholds,
    alertLevel,
    coverageDays,
    willRunOutBeforeResupply: coverageDays !== null && coverageDays < inputs.leadTimeDays,
    order,
  };
}
