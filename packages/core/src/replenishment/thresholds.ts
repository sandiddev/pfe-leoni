import { InvalidInputError } from "../errors/domain-error";
import { roundThreshold } from "../shared/rounding";

/**
 * Min / Max threshold computation — the enriched formulas (brief section 3.2).
 *
 *     Safety Stock = Average Daily Consumption x Safety Days
 *     Min          = Average Daily Consumption x (Lead Time + Safety Days)
 *     Max          = Min + Average Daily Consumption x Extra Coverage Days
 *
 * Why this enriches the logistics study rather than corrects it: the study's
 * `Min = Consumption x Lead Time` covers only LTN4's preparation and delivery
 * delay, so the trigger fires exactly when there is *just* enough stock to
 * survive a perfectly nominal lead time. Any variability in consumption during
 * that window — which is precisely what a safety stock exists to absorb — eats
 * into production. Moving the safety stock into the trigger means the minimum
 * covers the delay *plus* a margin, and the maximum becomes an explicit
 * post-replenishment coverage target rather than an incidental ceiling.
 *
 * The original formulas remain implemented in `legacy-thresholds.ts` so the two
 * can be compared side by side in the report.
 *
 * Every input below is data, read from `ReplenishmentParameter`, never a
 * constant in this file: the logistics team must be able to tune them per ABC
 * class or per article without a redeployment (section 3.4).
 */
export interface ThresholdInputs {
  /** Rolling mean consumption per day, from `rollingAverageDailyConsumption`. */
  readonly averageDailyConsumption: number;
  /** Days LTN4 needs to prepare and deliver. */
  readonly leadTimeDays: number;
  /** Margin against consumption variability, in days of consumption. */
  readonly safetyDays: number;
  /** Coverage the replenishment should restore on top of the minimum. */
  readonly extraCoverageDays: number;
}

export interface Thresholds {
  /** Days of consumption held as a buffer. */
  readonly safetyStock: number;
  /** Reorder point: at or below this, a replenishment need is raised. */
  readonly min: number;
  /** Target level after replenishment. */
  readonly max: number;
}

function assertValid(inputs: ThresholdInputs): void {
  // Listed explicitly rather than derived with `Object.entries(inputs)`: an
  // interface carries no index signature, so `Object.entries` would widen every
  // value to `any` and silently disable the very checks below.
  const values: Readonly<Record<string, number>> = {
    averageDailyConsumption: inputs.averageDailyConsumption,
    leadTimeDays: inputs.leadTimeDays,
    safetyDays: inputs.safetyDays,
    extraCoverageDays: inputs.extraCoverageDays,
  };

  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError(`\`${key}\` must be a finite number.`, { [key]: value });
    }
    if (value < 0) {
      throw new InvalidInputError(`\`${key}\` cannot be negative.`, { [key]: value });
    }
  }
}

/** Safety Stock = Average Daily Consumption x Safety Days (section 3.2). */
export function computeSafetyStock(
  inputs: Pick<ThresholdInputs, "averageDailyConsumption" | "safetyDays">,
): number {
  return roundThreshold(inputs.averageDailyConsumption * inputs.safetyDays);
}

/** Min = Average Daily Consumption x (Lead Time + Safety Days) (section 3.2). */
export function computeMin(
  inputs: Pick<ThresholdInputs, "averageDailyConsumption" | "leadTimeDays" | "safetyDays">,
): number {
  return roundThreshold(inputs.averageDailyConsumption * (inputs.leadTimeDays + inputs.safetyDays));
}

/** Max = Min + Average Daily Consumption x Extra Coverage Days (section 3.2). */
export function computeMax(inputs: ThresholdInputs): number {
  const min = computeMin(inputs);
  return roundThreshold(min + inputs.averageDailyConsumption * inputs.extraCoverageDays);
}

/**
 * Computes the three thresholds together.
 *
 * Prefer this over the individual functions: it guarantees the invariant
 * `safetyStock <= min <= max` holds for a single consistent set of inputs, which
 * separate calls with drifting arguments could silently break.
 */
export function computeThresholds(inputs: ThresholdInputs): Thresholds {
  assertValid(inputs);

  return {
    safetyStock: computeSafetyStock(inputs),
    min: computeMin(inputs),
    max: computeMax(inputs),
  };
}
