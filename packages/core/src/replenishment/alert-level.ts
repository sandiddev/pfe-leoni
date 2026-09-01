import { InvalidInputError } from "../errors/domain-error";

/**
 * Stock alert levels (brief section 6.1).
 *
 * The whole point of the application is that this is computed continuously
 * rather than noticed by a human looking at a spreadsheet, so the definition of
 * each level has to be unambiguous and cheap to evaluate for every article.
 */
export const ALERT_LEVELS = ["NORMAL", "WARNING", "CRITICAL", "RUPTURE"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** Ascending severity — used to sort the alert board and to compare two levels. */
export const ALERT_LEVEL_SEVERITY: Readonly<Record<AlertLevel, number>> = {
  NORMAL: 0,
  WARNING: 1,
  CRITICAL: 2,
  RUPTURE: 3,
};

/**
 * How far above Min the early warning fires, as a fraction of Min.
 *
 * Stated assumption (0.2 = 20%): the brief defines Critical and Rupture but
 * leaves the early-warning band open. Twenty percent above the reorder point
 * gives the storekeeper roughly a fifth of a lead time of notice before the
 * article becomes critical, which is enough to batch it into an existing
 * request rather than raise an urgent one. It is a parameter, not a constant:
 * it lives in `ReplenishmentParameter.warningMarginRatio` and is editable per
 * ABC class from the Parameters screen.
 */
export const DEFAULT_WARNING_MARGIN_RATIO = 0.2;

export interface AlertLevelInputs {
  readonly currentStock: number;
  readonly min: number;
  readonly warningMarginRatio?: number;
}

/**
 * Resolves the alert level of a stock item.
 *
 *   RUPTURE  stock <= 0                          the line is starved now
 *   CRITICAL stock <= min                        replenishment is overdue
 *   WARNING  stock <= min x (1 + margin)         approaching the reorder point
 *   NORMAL   otherwise
 */
export function resolveAlertLevel(inputs: AlertLevelInputs): AlertLevel {
  const { currentStock, min } = inputs;
  const warningMarginRatio = inputs.warningMarginRatio ?? DEFAULT_WARNING_MARGIN_RATIO;

  if (!Number.isFinite(currentStock) || !Number.isFinite(min)) {
    throw new InvalidInputError("Stock and Min must be finite numbers.", { currentStock, min });
  }
  if (min < 0) {
    throw new InvalidInputError("Min cannot be negative.", { min });
  }
  if (warningMarginRatio < 0) {
    throw new InvalidInputError("The warning margin ratio cannot be negative.", {
      warningMarginRatio,
    });
  }

  if (currentStock <= 0) return "RUPTURE";
  if (currentStock <= min) return "CRITICAL";
  if (currentStock <= min * (1 + warningMarginRatio)) return "WARNING";
  return "NORMAL";
}

/** True when `level` is at least as severe as `atLeast`. */
export function isAtLeastAsSevere(level: AlertLevel, atLeast: AlertLevel): boolean {
  return ALERT_LEVEL_SEVERITY[level] >= ALERT_LEVEL_SEVERITY[atLeast];
}

/** Descending severity, for ordering the alert board. */
export function compareAlertSeverityDesc(left: AlertLevel, right: AlertLevel): number {
  return ALERT_LEVEL_SEVERITY[right] - ALERT_LEVEL_SEVERITY[left];
}

/** The levels that mean a replenishment is overdue rather than approaching. */
export const SHORTAGE_LEVELS: readonly AlertLevel[] = ["CRITICAL", "RUPTURE"];

/**
 * Whether a level change is worth telling somebody about.
 *
 * A *crossing*, not a state: an article that was already critical and got a
 * little more critical is not news, and notifying on every movement of an
 * article sitting below its reorder point is how a notification centre becomes
 * something people mute. What deserves an interruption is the moment the
 * article enters shortage, and the moment it gets worse — critical to rupture,
 * because the line is now actually starved.
 *
 * Recovery is deliberately silent. A stock that climbs back above Min is
 * visible on the alert board, and telling five people that a problem stopped
 * being a problem trains them to skim.
 *
 * `from` is null for an article that has no previous level to compare against —
 * a stock row created with its first movement. Treated as a crossing if the new
 * level is a shortage, because the first thing anybody should learn about a new
 * reference is that it arrived already short.
 */
export function crossedIntoShortage(from: AlertLevel | null, to: AlertLevel): boolean {
  if (!SHORTAGE_LEVELS.includes(to)) return false;
  if (from === null) return true;

  return ALERT_LEVEL_SEVERITY[to] > ALERT_LEVEL_SEVERITY[from];
}
