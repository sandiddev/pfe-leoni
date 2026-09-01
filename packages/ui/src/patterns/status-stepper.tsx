import { Check } from "lucide-react";

import { REQUEST_STATUS_LABELS_FR } from "@leoni/contracts";
import { isExceptionStatus, NOMINAL_STATUS_SEQUENCE, nominalStepIndex } from "@leoni/core";
import type { RequestStatus } from "@leoni/core";

import { cn } from "../lib/cn";
import { Badge } from "../primitives/badge";

export interface StatusStepperProps {
  readonly status: RequestStatus;
  readonly className?: string;
}

/**
 * Where a request has got to, along the nominal path.
 *
 * The sequence comes from `NOMINAL_STATUS_SEQUENCE` in the domain rather than
 * from a list written here, so adding a stage to the process moves this
 * component without editing it.
 *
 * An exception status (rejected, cancelled, LTN4 shortage) is off the path by
 * construction — `nominalStepIndex` returns null — and is shown as a banner
 * over the stepper instead of being forced onto a step it does not occupy.
 */
export function StatusStepper({ status, className }: StatusStepperProps) {
  const current = nominalStepIndex(status);

  return (
    <div className={cn("space-y-3", className)}>
      {current === null && (
        <div className="flex items-center gap-2 rounded-md bg-status-rupture-subtle px-3 py-2">
          <span className="text-sm text-status-rupture">
            {isExceptionStatus(status)
              ? "Cette demande est sortie du parcours nominal."
              : "Etape hors parcours nominal."}
          </span>
          <Badge variant="stopped">{REQUEST_STATUS_LABELS_FR[status]}</Badge>
        </div>
      )}

      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {NOMINAL_STATUS_SEQUENCE.map((step, index) => {
          const done = current !== null && index < current;
          const active = current === index;

          return (
            <li key={step} className="flex items-center gap-1">
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                  done && "bg-status-normal-subtle text-phase-done",
                  active && "bg-primary text-foreground-on-primary",
                  !done && !active && "bg-surface-sunken text-foreground-subtle",
                )}
                aria-current={active ? "step" : undefined}
              >
                {done && <Check className="size-3" />}
                {REQUEST_STATUS_LABELS_FR[step]}
              </span>
              {index < NOMINAL_STATUS_SEQUENCE.length - 1 && (
                <span aria-hidden className="h-px w-3 bg-border-strong" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
