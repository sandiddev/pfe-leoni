import { REQUEST_STATUS_LABELS_FR, type StatusCount } from "@leoni/contracts";
import { formatQuantity } from "@leoni/ui";

export interface StatusBarsProps {
  readonly counts: readonly StatusCount[];
}

/**
 * Requests by status, as bars.
 *
 * Statuses with no requests are dropped here rather than in the service: the
 * API returns all fourteen so an export is complete, and a chart with nine
 * empty rows is just harder to read.
 */
export function StatusBars({ counts }: StatusBarsProps) {
  const present = counts.filter((entry) => entry.count > 0);

  if (present.length === 0) {
    return <p className="text-sm text-foreground-muted">Aucune demande sur la periode.</p>;
  }

  const highest = Math.max(...present.map((entry) => entry.count));

  return (
    <ul className="space-y-2">
      {present.map((entry) => (
        <li key={entry.status} className="flex items-center gap-3">
          <span className="w-44 shrink-0 truncate text-sm text-foreground-muted">
            {REQUEST_STATUS_LABELS_FR[entry.status]}
          </span>
          <span className="h-3 flex-1 rounded-full bg-surface-sunken">
            <span
              className="block h-3 rounded-full bg-primary"
              style={{ width: `${String(Math.round((entry.count / highest) * 100))}%` }}
            />
          </span>
          <span className="tabular w-12 shrink-0 text-right text-sm font-medium">
            {formatQuantity(entry.count)}
          </span>
        </li>
      ))}
    </ul>
  );
}
