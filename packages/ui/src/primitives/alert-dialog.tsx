"use client";

import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { buttonVariants } from "./button";

export interface AlertDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly isPending?: boolean;
  readonly onConfirm: () => void;
  /** Extra context, e.g. the exact rows an action is about to affect. */
  readonly children?: ReactNode;
}

/**
 * Confirmation before an action that cannot simply be undone.
 *
 * `AlertDialog` rather than `Dialog`: it takes focus immediately, refuses to
 * close on an outside click, and announces itself as an alert. A confirmation
 * a user can dismiss by clicking past it is not a confirmation.
 *
 * The description is required, and should say what will happen rather than ask
 * "are you sure?" — the second question is answerable without reading.
 */
export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  destructive = true,
  isPending = false,
  onConfirm,
  children,
}: AlertDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <AlertDialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-dialog -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-border bg-surface-raised p-5 shadow-raised",
          )}
        >
          <AlertDialogPrimitive.Title className="text-base font-semibold text-foreground">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-1.5 text-sm text-foreground-muted">
            {description}
          </AlertDialogPrimitive.Description>

          {children !== undefined && <div className="mt-4">{children}</div>}

          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel
              className={buttonVariants({ variant: "outline", size: "md" })}
              disabled={isPending}
            >
              {cancelLabel}
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              className={buttonVariants({
                variant: destructive ? "destructive" : "primary",
                size: "md",
              })}
              disabled={isPending}
              onClick={(event) => {
                // Kept open while the mutation runs, so the spinner is visible
                // and a double-press cannot fire the action twice.
                event.preventDefault();
                onConfirm();
              }}
            >
              {isPending ? "En cours..." : confirmLabel}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
