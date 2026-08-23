import { roundTo } from "../shared/rounding";

/**
 * Stock coverage in days (brief section 6.5, "couverture de stock").
 *
 * This is the KPI the logistics manager actually steers on: "how many days of
 * production does this stock represent" is a far more actionable number than a
 * raw quantity, because it is already normalised by demand.
 */

/**
 * Days of consumption the current stock represents.
 *
 * Returns `null` — not `Infinity` — when the article has no measured
 * consumption. `null` forces every call site to decide how to present "this
 * article is not moving", whereas `Infinity` silently sorts to the top of a
 * "best covered" table and formats as a meaningless number on screen.
 */
export function daysOfCoverage(
  currentStock: number,
  averageDailyConsumption: number,
): number | null {
  if (averageDailyConsumption <= 0) return null;
  if (currentStock <= 0) return 0;
  return roundTo(currentStock / averageDailyConsumption, 1);
}

/**
 * Whether coverage falls short of what LTN4 needs to resupply.
 *
 * True means the article will run out before a replenishment requested today
 * could physically arrive — the condition that actually stops a line.
 */
export function isCoverageBelowLeadTime(
  coverageDays: number | null,
  leadTimeDays: number,
): boolean {
  if (coverageDays === null) return false;
  return coverageDays < leadTimeDays;
}
