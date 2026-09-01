"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "../lib/cn";
import { TableHead } from "../primitives/table";

export type SortDirection = "asc" | "desc";

export interface SortableTableHeadProps<TField extends string> {
  readonly field: TField;
  readonly activeField: TField;
  readonly direction: SortDirection;
  readonly onSort: (field: TField, direction: SortDirection) => void;
  readonly numeric?: boolean;
  readonly children: React.ReactNode;
}

/**
 * A column header that sorts.
 *
 * Every list API in this application already accepts `sortBy` and
 * `sortDirection`, and not one screen exposed them: the capability was built
 * and then only ever called with its default. This is the control that was
 * missing.
 *
 * `aria-sort` is set on the cell, which is what a screen reader announces —
 * an arrow icon alone tells a sighted user the state and nobody else.
 */
export function SortableTableHead<TField extends string>({
  field,
  activeField,
  direction,
  onSort,
  numeric = false,
  children,
}: SortableTableHeadProps<TField>) {
  const isActive = field === activeField;
  const Icon = isActive ? (direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <TableHead
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("p-0", numeric && "text-right")}
    >
      <button
        type="button"
        className={cn(
          "flex h-10 w-full items-center gap-1 px-3 text-xs font-semibold tracking-wide uppercase transition-colors",
          "hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          numeric && "justify-end",
          isActive ? "text-foreground" : "text-foreground-muted",
        )}
        onClick={() => {
          // A first click sorts ascending; clicking the active column flips it.
          onSort(field, isActive && direction === "asc" ? "desc" : "asc");
        }}
      >
        {children}
        <Icon className={cn("size-3 shrink-0", isActive ? "opacity-100" : "opacity-40")} />
      </button>
    </TableHead>
  );
}
