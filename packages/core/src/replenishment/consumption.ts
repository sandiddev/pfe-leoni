import { InvalidInputError } from "../errors/domain-error";
import { roundTo } from "../shared/rounding";

/**
 * Average daily consumption (brief section 2).
 *
 * Stated assumption: consumption is expressed per day and computed as a rolling
 * average over a configurable window — 30 days by default, with 7 and 90 also
 * offered, because a class C article with sporadic demand is badly represented
 * by a 7-day window while a class A article reacts too slowly on 90.
 */

export const AVERAGING_WINDOWS = [7, 30, 90] as const;
export type AveragingWindowDays = (typeof AVERAGING_WINDOWS)[number];

export const DEFAULT_AVERAGING_WINDOW_DAYS = 30;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ConsumptionSample {
  /** When the material actually left the store. */
  readonly occurredAt: Date;
  /** Quantity consumed, in units. Always positive. */
  readonly quantity: number;
}

export interface RollingAverageInput {
  /** Outbound movements only. Entries and adjustments are not consumption. */
  readonly samples: readonly ConsumptionSample[];
  readonly windowDays: number;
  /**
   * End of the observation window. Passed in rather than read from the clock so
   * that the calculation is deterministic and its tests are reproducible.
   */
  readonly now: Date;
}

/**
 * Mean consumption per day over the trailing `windowDays`.
 *
 * The denominator is the *window length*, not the number of days that happened
 * to have a movement. Dividing by active days only would overstate demand for
 * an article consumed once a fortnight, and every downstream threshold would
 * inherit that overstatement.
 */
export function rollingAverageDailyConsumption(input: RollingAverageInput): number {
  const { samples, windowDays, now } = input;

  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new InvalidInputError("The averaging window must be a positive number of days.", {
      windowDays,
    });
  }

  const windowStart = new Date(now.getTime() - windowDays * MILLISECONDS_PER_DAY);

  const consumedInWindow = samples.reduce((sum, sample) => {
    if (sample.quantity < 0) {
      throw new InvalidInputError("A consumption sample cannot have a negative quantity.", {
        quantity: sample.quantity,
      });
    }
    const isInWindow = sample.occurredAt > windowStart && sample.occurredAt <= now;
    return isInWindow ? sum + sample.quantity : sum;
  }, 0);

  return roundTo(consumedInWindow / windowDays, 3);
}
