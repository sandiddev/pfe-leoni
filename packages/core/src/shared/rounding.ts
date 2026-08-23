/**
 * Rounding helpers.
 *
 * Quantities of physical parts are always whole units; consumption rates and
 * thresholds are fractional. Rounding therefore happens at a small number of
 * well-named places rather than being scattered as `Math.round` calls.
 */

/** Rounds to a fixed number of decimals, avoiding the usual float drift. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Rounds a computed threshold to whole units.
 *
 * Thresholds round *up*: a minimum of 1 499.2 units must trigger at 1 500, not
 * 1 499, otherwise the safety margin is quietly eroded by rounding.
 */
export function roundThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(roundTo(value, 6));
}

/** Clamps a value into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
