import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

/**
 * Loading placeholder.
 *
 * Sized by the caller to match the content it stands in for, so the layout does
 * not jump when the data arrives — on a screen a storekeeper refreshes all day,
 * a shifting table is a mis-click waiting to happen.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-surface-sunken", className)}
      aria-hidden="true"
      {...props}
    />
  );
}
