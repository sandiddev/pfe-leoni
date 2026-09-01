import type { StockOutPoint } from "@leoni/contracts";
import { formatDate } from "@leoni/ui";

export interface TrendChartProps {
  readonly points: readonly StockOutPoint[];
  readonly label: string;
}

/** Room for the axis labels, in the SVG's own coordinate space. */
const WIDTH = 720;
const HEIGHT = 200;
const PADDING = 28;

/**
 * The stock-out rate over the window.
 *
 * Inline SVG rather than a charting library: this is one polyline over a
 * hundred points, and a dependency that ships a layout engine, an animation
 * runtime and a tooltip system to draw it would be several hundred kilobytes
 * for a shape that is nine lines of arithmetic.
 *
 * `preserveAspectRatio="none"` is deliberately not used — the stroke would
 * stretch with the box and read as a different weight at every screen size.
 */
export function TrendChart({ points, label }: TrendChartProps) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-foreground-muted">
        Pas encore assez d historique pour tracer une tendance.
      </p>
    );
  }

  const highest = Math.max(...points.map((point) => point.stockOutRate), 1);
  const step = (WIDTH - PADDING * 2) / (points.length - 1);

  const coordinates = points.map((point, index) => {
    const x = PADDING + index * step;
    const y = HEIGHT - PADDING - (point.stockOutRate / highest) * (HEIGHT - PADDING * 2);
    return `${String(Math.round(x))},${String(Math.round(y))}`;
  });

  const first = points[0];
  const last = points.at(-1);

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className="h-48 w-full"
        role="img"
        aria-label={`${label} : de ${String(points[0]?.stockOutRate ?? 0)} a ${String(last?.stockOutRate ?? 0)} pour cent`}
      >
        <line
          x1={PADDING}
          y1={HEIGHT - PADDING}
          x2={WIDTH - PADDING}
          y2={HEIGHT - PADDING}
          className="stroke-border-strong"
          strokeWidth={1}
        />
        <line
          x1={PADDING}
          y1={PADDING}
          x2={PADDING}
          y2={HEIGHT - PADDING}
          className="stroke-border-strong"
          strokeWidth={1}
        />

        <polyline
          points={coordinates.join(" ")}
          fill="none"
          className="stroke-status-rupture"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      <figcaption className="flex justify-between text-xs text-foreground-muted">
        <span>{formatDate(first?.date ?? null)}</span>
        <span>
          {label} — maximum {String(Math.round(highest))} %
        </span>
        <span>{formatDate(last?.date ?? null)}</span>
      </figcaption>
    </figure>
  );
}
