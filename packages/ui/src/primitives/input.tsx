import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-border-strong bg-surface px-3 py-1 text-sm",
        "placeholder:text-foreground-subtle",
        "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Quantities are compared down a column, so numeric inputs use
        // tabular figures like the tables they feed.
        type === "number" && "tabular",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("text-sm leading-none font-medium text-foreground", className)}
      {...props}
    />
  );
}
