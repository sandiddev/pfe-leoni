import type { ThresholdHistoryPoint } from "@leoni/contracts";
import { formatDate } from "@leoni/ui";

export interface ThresholdChartProps {
  readonly points: readonly ThresholdHistoryPoint[];
}

const WIDTH = 720;
const HEIGHT = 180;
const PADDING = 28;

/**
 * How Min and Max have moved over the recalculations.
 *
 * Two polylines over the same scale, oldest first — the history arrives newest
 * first because that is the order the table wants. Inline SVG for the same
 * reason as the dashboard: this is arithmetic over a handful of points, not a
 * reason to ship a charting runtime.
 */
export function ThresholdChart({ points }: ThresholdChartProps) {
  const ordered = [...points].sort(
    (left, right) => left.computedAt.getTime() - right.computedAt.getTime(),
  );

  if (ordered.length < 2) {
    return (
      <p className="text-sm text-foreground-muted">
        Il faut au moins deux recalculs pour tracer une evolution.
      </p>
    );
  }

  const highest = Math.max(...ordered.map((point) => point.maxThreshold), 1);
  const step = (WIDTH - PADDING * 2) / (ordered.length - 1);

  const line = (pick: (point: ThresholdHistoryPoint) => number): string =>
    ordered
      .map((point, index) => {
        const x = PADDING + index * step;
        const y = HEIGHT - PADDING - (pick(point) / highest) * (HEIGHT - PADDING * 2);
        return `${String(Math.round(x))},${String(Math.round(y))}`;
      })
      .join(" ");

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className="h-44 w-full"
        role="img"
        aria-label="Evolution des seuils mini et maxi au fil des recalculs"
      >
        <line
          x1={PADDING}
          y1={HEIGHT - PADDING}
          x2={WIDTH - PADDING}
          y2={HEIGHT - PADDING}
          className="stroke-border-strong"
          strokeWidth={1}
        />

        <polyline
          points={line((point) => point.maxThreshold)}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <polyline
          points={line((point) => point.minThreshold)}
          fill="none"
          className="stroke-status-critical"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </svg>

      <figcaption className="flex flex-wrap justify-between gap-2 text-xs text-foreground-muted">
        <span>{formatDate(ordered[0]?.computedAt ?? null)}</span>
        <span className="flex items-center gap-3">
          <span className="text-status-critical">— Seuil mini</span>
          <span className="text-primary">— Seuil maxi</span>
        </span>
        <span>{formatDate(ordered.at(-1)?.computedAt ?? null)}</span>
      </figcaption>
    </figure>
  );
}
