import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

/**
 * Table primitives.
 *
 * The wrapper owns the horizontal scroll rather than the page: an article table
 * has more columns than a 1366-wide warehouse monitor can show, and a page that
 * scrolls sideways as a whole is far worse to use than a table that does.
 */
export function TableContainer({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("w-full overflow-x-auto rounded-lg border border-border", className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("w-full caption-bottom text-sm", className)} {...props} />;
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-surface-sunken", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn("bg-surface transition-colors hover:bg-surface-sunken", className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-semibold tracking-wide text-foreground-muted uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;
}

/** Right-aligned cell with tabular figures, for every quantity in the app. */
export function TableNumericCell({ className, ...props }: ComponentProps<"td">) {
  return <TableCell className={cn("tabular text-right", className)} {...props} />;
}

export function TableNumericHead({ className, ...props }: ComponentProps<"th">) {
  return <TableHead className={cn("text-right", className)} {...props} />;
}
