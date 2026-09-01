import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "../lib/cn";
import { Label } from "../primitives/input";

export interface FieldProps {
  readonly label: string;
  /** Receives the id and the aria wiring; call it to render the control. */
  readonly children: (props: {
    readonly id: string;
    readonly "aria-describedby": string | undefined;
    readonly "aria-invalid": boolean | undefined;
  }) => ReactNode;
  readonly description?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly className?: string;
}

/**
 * Label, control, hint and error, wired together.
 *
 * A render prop rather than `cloneElement`, so the control keeps its own type
 * and the association between the label, the description and the error is made
 * by the component instead of by whoever remembers to write `aria-describedby`
 * — which, across five screens of forms, is nobody.
 */
export function Field({
  label,
  children,
  description,
  error,
  required = false,
  className,
}: FieldProps) {
  const id = useId();
  const descriptionId = description === undefined ? undefined : `${id}-description`;
  const errorId = error === undefined ? undefined : `${id}-error`;

  const describedBy = [descriptionId, errorId].filter((value) => value !== undefined).join(" ");

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        )}
      </Label>

      {children({
        id,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
        "aria-invalid": error === undefined ? undefined : true,
      })}

      {description !== undefined && (
        <p id={descriptionId} className="text-xs text-foreground-muted">
          {description}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-xs text-status-rupture">
          {error}
        </p>
      )}
    </div>
  );
}
