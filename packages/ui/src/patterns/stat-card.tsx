import type { ComponentType, ReactNode } from "react";

import { cn } from "../lib/cn";
import { Card } from "../primitives/card";

export interface StatCardProps {
  readonly label: string;
  readonly value: ReactNode;
  /** Unit or short qualifier shown next to the value, e.g. "jours", "articles". */
  readonly unit?: string;
  readonly hint?: string;
  readonly icon?: ComponentType<{ className?: string }>;
  /** Ties the tile to a domain status token when it reports a severity. */
  readonly tone?: "neutral" | "normal" | "warning" | "critical" | "rupture";
  readonly className?: string;
}

const TONE_CLASSES = {
  neutral: "text-foreground",
  normal: "text-status-normal",
  warning: "text-status-warning",
  critical: "text-status-critical",
  rupture: "text-status-rupture",
} as const;

/**
 * A single KPI tile.
 *
 * The value is deliberately the largest thing in the tile and uses tabular
 * figures: the dashboard is read at a glance, and a row of KPI numbers that do
 * not share a digit width cannot be compared at a glance.
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = "neutral",
  className,
}: StatCardProps) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground-muted">{label}</p>
        {Icon !== undefined && <Icon className={cn("size-4", TONE_CLASSES[tone])} />}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={cn("tabular text-2xl font-semibold", TONE_CLASSES[tone])}>{value}</span>
        {unit !== undefined && <span className="text-sm text-foreground-muted">{unit}</span>}
      </div>

      {hint !== undefined && <p className="mt-1 text-xs text-foreground-subtle">{hint}</p>}
    </Card>
  );
}
