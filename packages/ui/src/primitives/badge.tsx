import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

/**
 * Badge.
 *
 * The `status-*` and `phase-*` variants map onto the domain tokens rather than
 * onto colours, so the alert board, the request list and the dashboard render
 * the same state identically without agreeing on it individually.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-surface-sunken text-foreground-muted",
        primary: "bg-primary-subtle text-primary",
        outline: "border border-border-strong text-foreground-muted",

        // --- Stock alert levels (brief section 6.1) ---
        normal: "bg-status-normal-subtle text-status-normal",
        warning: "bg-status-warning-subtle text-status-warning",
        critical: "bg-status-critical-subtle text-status-critical",
        rupture: "bg-status-rupture-subtle text-status-rupture",

        // --- Request workflow phases (brief section 5) ---
        draft: "bg-surface-sunken text-phase-draft",
        pending: "bg-status-warning-subtle text-phase-pending",
        active: "bg-primary-subtle text-phase-active",
        done: "bg-status-normal-subtle text-phase-done",
        stopped: "bg-status-rupture-subtle text-phase-stopped",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
