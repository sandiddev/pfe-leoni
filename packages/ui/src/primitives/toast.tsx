"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { cn } from "../lib/cn";

/**
 * Transient feedback.
 *
 * Before this existed, a successful save was silent and a failure was a grey
 * paragraph somewhere below the fold. Both are the same bug: the user pressed a
 * button and the interface did not say what happened.
 *
 * Errors do not auto-dismiss. A success message the user misses costs nothing;
 * an error message that vanishes before it is read costs a support call.
 */

const TONES = {
  success: { icon: CircleCheck, className: "border-status-normal text-status-normal" },
  error: { icon: CircleAlert, className: "border-destructive text-status-rupture" },
  info: { icon: Info, className: "border-border-strong text-foreground" },
} as const;

export type ToastTone = keyof typeof TONES;

export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
}

interface QueuedToast extends ToastOptions {
  readonly id: number;
}

interface ToastContextValue {
  readonly toast: (options: ToastOptions) => void;
  /** Shorthands, because these two are the overwhelming majority of calls. */
  readonly success: (title: string, description?: string) => void;
  readonly error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const SUCCESS_DURATION_MS = 4_000;
/** Radix treats `Infinity` as "never", which is what an error needs. */
const ERROR_DURATION_MS = Number.POSITIVE_INFINITY;

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);

  if (value === null) {
    throw new Error("useToast must be used inside <Toaster>. Mount it in the root layout.");
  }

  return value;
}

/** Mounted once in the root layout, above everything that might report. */
export function Toaster({ children }: { readonly children: ReactNode }) {
  const [queue, setQueue] = useState<readonly QueuedToast[]>([]);

  // A ref, not state: the counter only has to be unique, and making it state
  // would re-render every mounted toast each time a new one is pushed.
  const nextId = useRef(0);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current;
    nextId.current += 1;
    setQueue((current) => [...current, { ...options, id }]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => {
        toast({ title, tone: "success", ...(description === undefined ? {} : { description }) });
      },
      error: (title, description) => {
        toast({ title, tone: "error", ...(description === undefined ? {} : { description }) });
      },
    }),
    [toast],
  );

  const dismiss = (id: number) => {
    setQueue((current) => current.filter((entry) => entry.id !== id));
  };

  return (
    <ToastContext value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}

        {queue.map((entry) => {
          const tone = TONES[entry.tone ?? "info"];
          const Icon = tone.icon;

          return (
            <ToastPrimitive.Root
              key={entry.id}
              duration={entry.tone === "error" ? ERROR_DURATION_MS : SUCCESS_DURATION_MS}
              onOpenChange={(open) => {
                if (!open) dismiss(entry.id);
              }}
              className={cn(
                "flex items-start gap-3 rounded-lg border-l-4 border border-border bg-surface-raised p-3 shadow-raised",
                "data-[swipe=end]:translate-x-full",
                tone.className,
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />

              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-sm font-medium text-foreground">
                  {entry.title}
                </ToastPrimitive.Title>
                {entry.description !== undefined && (
                  <ToastPrimitive.Description className="mt-0.5 text-sm text-foreground-muted">
                    {entry.description}
                  </ToastPrimitive.Description>
                )}
              </div>

              <ToastPrimitive.Close
                aria-label="Fermer"
                className="shrink-0 rounded text-foreground-subtle hover:text-foreground"
              >
                <X className="size-4" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}

        <ToastPrimitive.Viewport className="fixed right-0 bottom-0 z-50 flex w-96 max-w-full flex-col gap-2 p-4" />
      </ToastPrimitive.Provider>
    </ToastContext>
  );
}
