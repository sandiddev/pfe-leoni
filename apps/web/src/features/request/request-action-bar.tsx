"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  type AvailableAction,
  REQUEST_ACTION_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
} from "@leoni/contracts";
import type { TransitionAction } from "@leoni/core";
import { Button, Dialog, Label, Textarea, useToast } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface RequestActionBarProps {
  readonly requestId: string;
  /** Derived on the server from the domain transition table for this role. */
  readonly actions: readonly AvailableAction[];
}

/** Actions that end a request badly enough to deserve a destructive button. */
const DESTRUCTIVE: readonly TransitionAction[] = [
  "reject",
  "cancel",
  "declareStockOut",
  "declarePartial",
];

/**
 * The buttons the current user may press.
 *
 * The list is not written here: it comes from `availableTransitions` in the
 * domain, so a button that appears is a button the server will accept, and
 * adding a stage to the process moves this bar without editing it.
 *
 * A transition the domain marks `requiresReason` opens the dialog instead of
 * firing — a rejection nobody has to explain is exactly the opacity this
 * project removes.
 */
export function RequestActionBar({ requestId, actions }: RequestActionBarProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const [pending, setPending] = useState<AvailableAction | null>(null);
  const [reason, setReason] = useState("");

  const transition = useMutation(
    trpc.request.transition.mutationOptions({
      onSuccess: (result) => {
        setPending(null);
        setReason("");

        const moved = REQUEST_STATUS_LABELS_FR[result.status];
        const putAway = result.stockEntries.reduce((sum, entry) => sum + entry.quantity, 0);

        toast.success(
          `Demande ${moved.toLowerCase()}`,
          // A receipt is the one transition that also moves stock, and saying
          // so is how the storekeeper knows they need not record it by hand.
          putAway > 0
            ? `${String(putAway)} unite(s) entrees en stock a la reception.`
            : undefined,
        );
        router.refresh();
      },
      onError: (cause) => {
        toast.error("Action refusee", cause.message);
      },
    }),
  );

  const run = (action: AvailableAction, justification?: string) => {
    transition.mutate({
      requestId,
      action: action.action,
      ...(justification === undefined ? {} : { reason: justification }),
    });
  };

  if (actions.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">
        Aucune action disponible : la demande est cloturee, ou votre role n intervient pas a cette
        etape.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.action}
            variant={DESTRUCTIVE.includes(action.action) ? "outline" : "primary"}
            disabled={transition.isPending}
            onClick={() => {
              if (action.requiresReason) {
                setPending(action);
                return;
              }
              run(action);
            }}
          >
            {REQUEST_ACTION_LABELS_FR[action.action]}
          </Button>
        ))}
      </div>


      {pending !== null && (
        <Dialog
          open
          onClose={() => {
            setPending(null);
          }}
          title={REQUEST_ACTION_LABELS_FR[pending.action]}
          description="Cette action doit etre justifiee. Le motif est conserve dans l historique de la demande."
          footer={
            <>
              <Button
                variant="outline"
                disabled={transition.isPending}
                onClick={() => {
                  setPending(null);
                }}
              >
                Annuler
              </Button>
              <Button
                disabled={transition.isPending || reason.trim().length < 10}
                onClick={() => {
                  run(pending, reason);
                }}
              >
                {transition.isPending ? "Enregistrement..." : "Confirmer"}
              </Button>
            </>
          }
        >
          <div className="space-y-1.5">
            <Label htmlFor="transition-reason">Motif (10 caracteres minimum)</Label>
            <Textarea
              id="transition-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
