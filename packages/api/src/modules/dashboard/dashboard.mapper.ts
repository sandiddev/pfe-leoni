import type {
  DashboardSummary,
  LeadTimeSummary,
  ServiceLevel,
  StockOutPoint,
} from "@leoni/contracts";
import { ALERT_LEVELS, REQUEST_STATUSES, roundTo } from "@leoni/core";
import type { AlertLevel } from "@leoni/core";

/**
 * The KPI arithmetic, and the CSV the logistics manager exports.
 *
 * This is a mapper rather than a service because none of it is a decision: it
 * turns rows into figures. What it must never do is invent one — a rate with no
 * denominator is `null`, not `0`, for exactly the reason coverage is `null` for
 * an unconsumed article.
 */

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** A percentage, or `null` when there is nothing to divide by. */
function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : roundTo((part / whole) * 100, 1);
}

function averageDays(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, 1);
}

interface SnapshotRow {
  readonly snapshotDate: Date;
  readonly level: AlertLevel;
}

/**
 * One point per day, from the snapshot table.
 *
 * The denominator is the number of articles photographed that day rather than
 * today's catalogue size: an article added last week did not exist in February,
 * and dividing February by today's total would quietly flatter the history.
 */
export function toStockOutHistory(rows: readonly SnapshotRow[]): readonly StockOutPoint[] {
  const byDay = new Map<string, { date: Date; counts: Map<AlertLevel, number> }>();

  for (const row of rows) {
    const key = row.snapshotDate.toISOString().slice(0, 10);
    const day = byDay.get(key) ?? { date: row.snapshotDate, counts: new Map<AlertLevel, number>() };
    day.counts.set(row.level, (day.counts.get(row.level) ?? 0) + 1);
    byDay.set(key, day);
  }

  return [...byDay.values()]
    .sort((left, right) => left.date.getTime() - right.date.getTime())
    .map((day) => {
      const tracked = ALERT_LEVELS.reduce((sum, level) => sum + (day.counts.get(level) ?? 0), 0);
      const rupture = day.counts.get("RUPTURE") ?? 0;

      return {
        date: day.date,
        trackedArticles: tracked,
        rupture,
        critical: day.counts.get("CRITICAL") ?? 0,
        warning: day.counts.get("WARNING") ?? 0,
        stockOutRate: rate(rupture, tracked) ?? 0,
      };
    });
}

interface SettledLine {
  readonly requestedQuantity: number;
  readonly approvedQuantity: number | null;
  readonly receivedQuantity: number | null;
  readonly article: { readonly leadTimeDays: number };
}

interface SettledRequest {
  readonly createdAt: Date;
  readonly submittedAt: Date | null;
  readonly approvedAt: Date | null;
  readonly sentAt: Date | null;
  readonly receivedAt: Date | null;
  readonly expectedDeliveryAt: Date | null;
  readonly lines: readonly SettledLine[];
}

/**
 * Whether a request was served in full.
 *
 * Measured against what was *authorised*, not what was asked for: a manager who
 * approves 300 of a requested 500 has changed the commitment, and holding LTN4
 * to the original figure would report a shortfall that nobody promised to
 * cover. A line with no authorised figure falls back to the requested one.
 */
function isFullyServed(request: SettledRequest): boolean {
  return request.lines.every((line) => {
    const committed = line.approvedQuantity ?? line.requestedQuantity;
    return (line.receivedQuantity ?? 0) >= committed;
  });
}

function daysBetween(from: Date | null, to: Date | null): number | null {
  if (from === null || to === null) return null;
  return (to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY;
}

export function toServiceLevel(requests: readonly SettledRequest[]): ServiceLevel {
  const fullyServed = requests.filter(isFullyServed).length;

  // A request with no committed date cannot be late, and must not count against
  // on-time delivery either — it would penalise LTN4 for a promise never made.
  const withCommitment = requests.filter((request) => request.expectedDeliveryAt !== null);
  const onTime = withCommitment.filter(
    (request) =>
      request.receivedAt !== null &&
      request.expectedDeliveryAt !== null &&
      request.receivedAt <= request.expectedDeliveryAt,
  ).length;

  return {
    closedRequests: requests.length,
    fullyServed,
    rate: rate(fullyServed, requests.length),
    onTime,
    onTimeRate: rate(onTime, withCommitment.length),
  };
}

export function toLeadTime(requests: readonly SettledRequest[]): LeadTimeSummary {
  const real: number[] = [];
  const theoretical: number[] = [];
  const approval: number[] = [];

  for (const request of requests) {
    // Measured from transmission, because that is when LTN4's clock starts.
    const realDays = daysBetween(request.sentAt, request.receivedAt);
    if (realDays !== null) {
      real.push(realDays);
      // The commitment the article master implies for this request is the
      // slowest of its lines: the truck leaves when everything is picked.
      theoretical.push(
        Math.max(...request.lines.map((line) => line.article.leadTimeDays), 0),
      );
    }

    const approvalDays = daysBetween(request.submittedAt ?? request.createdAt, request.approvedAt);
    if (approvalDays !== null) approval.push(approvalDays);
  }

  return {
    measuredRequests: real.length,
    averageRealDays: averageDays(real),
    averageTheoreticalDays: averageDays(theoretical),
    averageApprovalDays: averageDays(approval),
  };
}

/** Every status listed, so one with no requests reads as 0 rather than vanishing. */
export function toRequestsByStatus(
  grouped: readonly { status: string; count: number }[],
): DashboardSummary["requestsByStatus"] {
  const counts = new Map(grouped.map((group) => [group.status, group.count]));
  return REQUEST_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

/** `;` rather than `,`: French Excel reads a comma as a decimal separator. */
const SEPARATOR = ";";

function csvRow(cells: readonly (string | number)[]): string {
  return cells.map((cell) => String(cell)).join(SEPARATOR);
}

/**
 * The KPI series as a spreadsheet.
 *
 * Built here rather than in the browser so that the exported figures are the
 * same objects the screen rendered — an export computed a second time client
 * side is an export that can disagree with the chart above it.
 */
export function toCsv(summary: DashboardSummary): string {
  const lines = [
    csvRow(["Indicateur", "Valeur"]),
    csvRow(["Articles suivis", summary.trackedArticles]),
    csvRow(["Demandes en cours", summary.openRequests]),
    csvRow(["Demandes en retard", summary.lateRequests]),
    csvRow(["Taux de service (%)", summary.serviceLevel.rate ?? ""]),
    csvRow(["Livraisons a l heure (%)", summary.serviceLevel.onTimeRate ?? ""]),
    csvRow(["Delai reel moyen (j)", summary.leadTime.averageRealDays ?? ""]),
    csvRow(["Delai theorique moyen (j)", summary.leadTime.averageTheoreticalDays ?? ""]),
    csvRow(["Delai de validation moyen (j)", summary.leadTime.averageApprovalDays ?? ""]),
    "",
    csvRow(["Date", "Articles suivis", "Rupture", "Critique", "Alerte", "Taux de rupture (%)"]),
    ...summary.stockOutHistory.map((point) =>
      csvRow([
        point.date.toISOString().slice(0, 10),
        point.trackedArticles,
        point.rupture,
        point.critical,
        point.warning,
        point.stockOutRate,
      ]),
    ),
  ];

  return lines.join("\n");
}
