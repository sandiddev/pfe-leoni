/**
 * French formatting helpers.
 *
 * Centralised so that a quantity is written the same way on every screen and in
 * every export. `fr-FR` uses a narrow no-break space as the thousands
 * separator, which is what a French-speaking storekeeper expects to read.
 */

const INTEGER_FORMATTER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const DECIMAL_FORMATTER = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
});

/** A quantity of physical parts. Always a whole number of units. */
export function formatQuantity(value: number): string {
  return INTEGER_FORMATTER.format(value);
}

/** A rate or a threshold, to one decimal. */
export function formatDecimal(value: number): string {
  return DECIMAL_FORMATTER.format(value);
}

/**
 * Days of stock coverage.
 *
 * `null` means the article has no measured consumption, which is genuinely
 * different from "zero days of cover" and must not be shown as a number.
 */
export function formatCoverage(days: number | null): string {
  if (days === null) return "—";
  return `${DECIMAL_FORMATTER.format(days)} j`;
}

export function formatDate(value: Date | null): string {
  if (value === null) return "—";
  return DATE_FORMATTER.format(value);
}

export function formatDateTime(value: Date | null): string {
  if (value === null) return "—";
  return DATE_TIME_FORMATTER.format(value);
}
