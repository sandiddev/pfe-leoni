import { LoaderCircle } from "lucide-react";

import { cn } from "../lib/cn";

export interface SpinnerProps {
  readonly className?: string;
  /** Announced to a screen reader; the icon itself is decorative. */
  readonly label?: string;
}

/**
 * A busy indicator.
 *
 * The label is not optional in practice: a spinning shape with no accessible
 * name tells a screen-reader user that something is happening but not what.
 */
export function Spinner({ className, label = "Chargement en cours" }: SpinnerProps) {
  return (
    <>
      <LoaderCircle className={cn("size-4 animate-spin", className)} aria-hidden />
      <span className="sr-only">{label}</span>
    </>
  );
}
