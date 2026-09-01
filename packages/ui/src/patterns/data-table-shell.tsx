import type { ReactNode } from "react";

import { Skeleton } from "../primitives/skeleton";
import { EmptyState, type EmptyStateProps } from "./empty-state";

export interface DataTableShellProps {
  /** True only on the very first load; a refetch keeps the previous rows. */
  readonly isLoading: boolean;
  readonly isFetching?: boolean;
  readonly error?: string | undefined;
  readonly isEmpty: boolean;
  readonly empty: EmptyStateProps;
  /** Row count line above the table, e.g. "24 articles". */
  readonly caption?: ReactNode;
  /** Filters and bulk actions. Stays visible while the table below is loading. */
  readonly toolbar?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The loading / empty / error frame every list screen needs.
 *
 * Each of the six list screens was going to write the same four branches, and
 * four branches written six times is four branches that disagree six ways —
 * one screen showing a spinner where another shows stale rows, one silently
 * rendering nothing on error. The states are decided once here.
 */
export function DataTableShell({
  isLoading,
  isFetching = false,
  error,
  isEmpty,
  empty,
  caption,
  toolbar,
  children,
}: DataTableShellProps) {
  return (
    <div className="space-y-4">
      {/* The toolbar renders in every state. Filters that disappear while their
          own results load leave the user unable to correct the filter that is
          returning nothing. */}
      {toolbar}

      {caption !== undefined && !isLoading && error === undefined && (
        <p className="text-sm text-foreground-muted" aria-live="polite">
          {caption}
          {isFetching && " - actualisation..."}
        </p>
      )}

      <Body
        isLoading={isLoading}
        error={error}
        isEmpty={isEmpty}
        empty={empty}
        content={children}
      />
    </div>
  );
}

interface BodyProps {
  readonly isLoading: boolean;
  readonly error: string | undefined;
  readonly isEmpty: boolean;
  readonly empty: EmptyStateProps;
  readonly content: ReactNode;
}

/** The four states a list can be in, decided once for every screen. */
function Body({ isLoading, error, isEmpty, empty, content }: BodyProps) {
  if (error !== undefined) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive bg-status-rupture-subtle px-4 py-3 text-sm text-status-rupture"
      >
        {error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return isEmpty ? <EmptyState {...empty} /> : content;
}
