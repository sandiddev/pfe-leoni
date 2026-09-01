import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

/**
 * Select.
 *
 * A styled native `<select>`. The alternative — a listbox built out of divs —
 * would cost keyboard handling, screen-reader semantics and the mobile wheel
 * picker, all of which the platform already implements correctly. The only
 * thing the browser will not do is match the design system, so that is the only
 * thing this file does.
 */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-9 w-full appearance-none rounded-md border border-border-strong bg-surface",
        "px-3 py-1 pr-8 text-sm text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
