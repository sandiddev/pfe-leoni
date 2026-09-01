"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { AlertDialog } from "../primitives/alert-dialog";
import { Button, type ButtonProps } from "../primitives/button";

export interface ConfirmButtonProps extends Omit<ButtonProps, "onClick"> {
  readonly confirmTitle: string;
  /** What will happen, not "are you sure?" — the second is answerable unread. */
  readonly confirmDescription: string;
  readonly confirmLabel?: string;
  readonly isPending?: boolean;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
}

/**
 * A button whose action is confirmed before it fires.
 *
 * One component rather than a dialog wired up per screen, because the rule is
 * "every irreversible action asks first" and a rule enforced by remembering is
 * a rule with exceptions. Reaching for `<Button>` on a cancel or a delete now
 * looks wrong next to the six places that use this one.
 */
export function ConfirmButton({
  confirmTitle,
  confirmDescription,
  confirmLabel,
  isPending = false,
  onConfirm,
  children,
  variant = "destructive",
  ...props
}: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        disabled={isPending}
        onClick={() => {
          setOpen(true);
        }}
        {...props}
      >
        {children}
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={setOpen}
        title={confirmTitle}
        description={confirmDescription}
        destructive={variant === "destructive"}
        isPending={isPending}
        {...(confirmLabel === undefined ? {} : { confirmLabel })}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
      />
    </>
  );
}
