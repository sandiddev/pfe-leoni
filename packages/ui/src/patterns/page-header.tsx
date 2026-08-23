import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export interface PageHeaderProps {
  readonly title: string;
  readonly description?: string;
  /** Primary actions for the page, aligned right. */
  readonly actions?: ReactNode;
  readonly className?: string;
}

/**
 * The heading of every page.
 *
 * Exists so that the title, the one-line explanation and the action buttons sit
 * in the same place on every screen. A user who has learned where the primary
 * action is on one page has learned it everywhere.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description !== undefined && (
          <p className="text-sm text-foreground-muted">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
