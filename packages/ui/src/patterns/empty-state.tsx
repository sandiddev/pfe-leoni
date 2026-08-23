import type { ComponentType, ReactNode } from "react";

import { cn } from "../lib/cn";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: ComponentType<{ className?: string }>;
  readonly action?: ReactNode;
  readonly className?: string;
}

/**
 * Shown when a list has nothing in it.
 *
 * An empty table with no explanation is ambiguous: it could mean "no articles
 * are below their threshold" — which is good news — or "your filters exclude
 * everything" — which is a mistake to correct. The description is where that
 * distinction gets made, so it is worth writing for each screen.
 */
export function EmptyState({ title, description, icon: Icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong px-6 py-12 text-center",
        className,
      )}
    >
      {Icon !== undefined && <Icon className="size-8 text-foreground-subtle" />}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description !== undefined && (
          <p className="mx-auto max-w-sm text-sm text-foreground-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
