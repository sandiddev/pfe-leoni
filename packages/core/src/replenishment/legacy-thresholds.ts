import { roundThreshold } from "../shared/rounding";

/**
 * The logistics study's original formulas (brief section 3.1), kept as a
 * documented comparative reference:
 *
 *     Min = Average Consumption x Lead Time
 *     Max = Min + Safety Stock
 *
 * These are not used to drive the application. They exist so the report — and
 * the "comparaison des modeles" screen — can show, on real article data, what
 * the enriched model in `thresholds.ts` changes and why. Deleting this file
 * would remove the ability to defend that change with numbers.
 */
export interface LegacyThresholdInputs {
  readonly averageDailyConsumption: number;
  readonly leadTimeDays: number;
  /** In the original model the safety stock is an absolute quantity, not days. */
  readonly safetyStock: number;
}

export interface LegacyThresholds {
  readonly min: number;
  readonly max: number;
}

export function computeLegacyThresholds(inputs: LegacyThresholdInputs): LegacyThresholds {
  const min = roundThreshold(inputs.averageDailyConsumption * inputs.leadTimeDays);
  return { min, max: roundThreshold(min + inputs.safetyStock) };
}
