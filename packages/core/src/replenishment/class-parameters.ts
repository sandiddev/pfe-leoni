import type { AbcClass } from "./abc-class";
import { DEFAULT_WARNING_MARGIN_RATIO } from "./alert-level";
import { DEFAULT_AVERAGING_WINDOW_DAYS } from "./consumption";

/**
 * The per-ABC-class tuning defaults (brief section 3.4).
 *
 * These numbers are *defaults*, not constants: in a running installation every
 * one of them is a column on `ReplenishmentParameter`, editable per class or
 * per article from the Parameters screen without a redeployment. What lives
 * here is the value used when no row has been written yet — a freshly migrated
 * database, or a class whose row an administrator deleted.
 *
 * They are in this file because they were previously in four places that
 * disagreed: the seed wrote A=2/3, B=1.5/5, C=1/10; the article service fell
 * back to 1/10 for *every* class; a third site inside the seed fell back to
 * `?? 1` / `?? 10`; and the Prisma column defaults were a flat 1/5. A class-A
 * article whose parameter row was missing therefore silently received class-C
 * thresholds — a quieter failure than a crash and a worse one, because the
 * numbers still looked plausible on screen.
 *
 * Why the values differ by class: a class A reference is consumed fast and
 * stopping the line over it is expensive, so it gets a wider safety margin
 * (2 days) but a tighter restock target (3 days) to avoid tying up floor space
 * in fast-moving stock. Class C inverts both: little consumption, so a thin
 * margin is enough, and a large restock quantity is cheap to hold and saves
 * repeated transfers between the plants.
 */
export interface ClassParameters {
  /** Margin against consumption variability, in days of consumption. */
  readonly safetyDays: number;
  /** Coverage restored on top of the minimum when replenishing. */
  readonly extraCoverageDays: number;
  /** Window for the rolling consumption average. */
  readonly averagingWindowDays: number;
  /** How far above Min the early warning fires, as a fraction of Min. */
  readonly warningMarginRatio: number;
}

export const DEFAULT_CLASS_PARAMETERS: Readonly<Record<AbcClass, ClassParameters>> = {
  A: {
    safetyDays: 2,
    extraCoverageDays: 3,
    averagingWindowDays: DEFAULT_AVERAGING_WINDOW_DAYS,
    warningMarginRatio: DEFAULT_WARNING_MARGIN_RATIO,
  },
  B: {
    safetyDays: 1.5,
    extraCoverageDays: 5,
    averagingWindowDays: DEFAULT_AVERAGING_WINDOW_DAYS,
    warningMarginRatio: DEFAULT_WARNING_MARGIN_RATIO,
  },
  C: {
    safetyDays: 1,
    extraCoverageDays: 10,
    averagingWindowDays: DEFAULT_AVERAGING_WINDOW_DAYS,
    warningMarginRatio: DEFAULT_WARNING_MARGIN_RATIO,
  },
};

/** The defaults for one class. Total, so there is no fallback to get wrong. */
export function defaultParametersForClass(abcClass: AbcClass): ClassParameters {
  return DEFAULT_CLASS_PARAMETERS[abcClass];
}
