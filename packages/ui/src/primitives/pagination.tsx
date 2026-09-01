import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "./button";

export interface PaginationProps {
  /** 1-based, for the "Page N" label. */
  readonly page: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  /** Total matching rows, when the query knows it. */
  readonly totalCount?: number;
}

/**
 * Previous / next, matching the cursor pagination the API exposes.
 *
 * Deliberately not numbered pages: the API returns a cursor and a total, not an
 * offset, so a "page 7" link would have to walk six pages to build itself. The
 * total is shown as a count instead, which is the part a user actually wanted.
 */
export function Pagination({
  page,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  totalCount,
}: PaginationProps) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm text-foreground-muted">
      <p>
        Page <span className="tabular font-medium text-foreground">{page}</span>
        {totalCount !== undefined && (
          <>
            {" · "}
            <span className="tabular font-medium text-foreground">{totalCount}</span> resultat
            {totalCount > 1 ? "s" : ""}
          </>
        )}
      </p>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onPrevious} disabled={!hasPrevious}>
          <ChevronLeft />
          Precedent
        </Button>
        <Button variant="outline" size="sm" onClick={onNext} disabled={!hasNext}>
          Suivant
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
