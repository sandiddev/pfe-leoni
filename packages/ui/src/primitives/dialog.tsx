"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { Button } from "./button";

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  /** Action buttons, right-aligned under a separator. */
  readonly footer?: ReactNode;
  readonly className?: string;
}

/**
 * Modal dialog.
 *
 * This was built on the native `<dialog>` element, which was the right call
 * while it was the only modal in the application: `showModal()` gives focus
 * trapping, the inert backdrop and Escape for free.
 *
 * It moved to Radix when the toast viewport and the confirmation dialog
 * arrived. The native element manages the top layer itself and knows nothing
 * about a React portal rendered beside it, so a confirmation opened from inside
 * a dialog ended up behind it, and focus returned to the wrong element on
 * close. Radix coordinates all three because they share one dismiss stack.
 *
 * The prop surface is unchanged, so no call site had to move with it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />

        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-dialog w-dialog -translate-x-1/2 -translate-y-1/2 flex-col",
            "rounded-lg border border-border bg-surface-raised text-foreground shadow-raised",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="space-y-1">
              <DialogPrimitive.Title className="text-base font-semibold text-foreground">
                {title}
              </DialogPrimitive.Title>
              {description === undefined ? (
                // Radix warns when a dialog has no description; saying there is
                // none deliberately is better than silencing the warning.
                <DialogPrimitive.Description className="sr-only">
                  {title}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="text-sm text-foreground-muted">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>

            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Fermer">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {/* The body scrolls, not the page: a long form in a modal that pushes
              the footer off-screen hides its own submit button. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer !== undefined && (
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
