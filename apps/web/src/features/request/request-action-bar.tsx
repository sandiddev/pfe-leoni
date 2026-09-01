"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  type AvailableAction,
  REQUEST_ACTION_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  type RequestLineItem,
} from "@leoni/contracts";
import { type CarriedFromField, quantityPlanFor, type TransitionAction } from "@leoni/core";
import { Button, Dialog, formatQuantity, Input, Label, Textarea, useToast } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface RequestActionBarProps {
  readonly requestId: string;
  /** Derived on the server from the domain transition table for this role. */
  readonly actions: readonly AvailableAction[];
  /** Needed to offer per-line quantities; the detail view already has them. */
  readonly lines: readonly RequestLineItem[];
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
 * The dialog is one component covering three cases, because they compose: an
 * action may need a justification (`requiresReason`), a per-line quantity
 * (`quantityPlanFor`), or both — `declarePartial` is exactly "how much, and
 * why". A second dialog for quantities would have duplicated the submit path
 * and let the two drift.
 *
 * Which column a quantity lands in is *not* decided here. The client names the
 * action; `QUANTITY_PLANS` in the domain maps it to a column, server-side. That
 * is why this file can offer the right prompt without being able to write
 * "received" while approving.
 */
export function RequestActionBar({ requestId, actions, lines }: RequestActionBarProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const [pending, setPending] = useState<AvailableAction | null>(null);
  const [reason, setReason] = useState("");
  /** Keyed by line id, held as text so a half-typed figure is not coerced to 0. */
  const [quantities, setQuantities] = useState<Readonly<Record<string, string>>>({});

  const close = () => {
    setPending(null);
    setReason("");
    setQuantities({});
  };

  const transition = useMutation(
    trpc.request.transition.mutationOptions({
      onSuccess: (result) => {
        close();

        const moved = REQUEST_STATUS_LABELS_FR[result.status];
        const putAway = result.stockEntries.reduce((sum, entry) => sum + entry.quantity, 0);
        const shipped = result.stockExits.reduce((sum, exit) => sum + exit.quantity, 0);

        // The two transitions that move stock say so, because the whole point
        // is that nobody records the movement by hand afterwards. A dispatch
        // debits the supplying plant; a receipt credits the consuming one.
        const movement =
          putAway > 0
            ? `${formatQuantity(putAway)} unite(s) entrees en stock a la reception.`
            : shipped > 0
              ? `${formatQuantity(shipped)} unite(s) sorties du stock LTN4 a l expedition.`
              : undefined;

        toast.success(`Demande ${moved.toLowerCase()}`, movement);
        router.refresh();
      },
      onError: (cause) => {
        toast.error("Action refusee", cause.message);
      },
    }),
  );

  /**
   * The figure this stage starts from, mirroring the domain's carry-forward.
   *
   * Prefilling matters: the common case is "prepare what was approved", and a
   * dialog that opened empty would make the frequent action harder in order to
   * enable the rare one.
   */
  const carriedForward = (line: RequestLineItem, from: readonly CarriedFromField[]): number => {
    for (const field of from) {
      const value = line[field];
      if (value !== null) return value;
    }
    return line.requestedQuantity;
  };

  const open = (action: AvailableAction) => {
    const plan = quantityPlanFor(action.action);

    // No justification and no quantity to record: nothing to ask, so fire.
    if (!action.requiresReason && plan === null) {
      transition.mutate({ requestId, action: action.action });
      return;
    }

    setPending(action);
    setReason("");
    setQuantities(
      plan === null
        ? {}
        : Object.fromEntries(
            lines.map((line) => [line.id, String(carriedForward(line, plan.from))]),
          ),
    );
  };

  const plan = pending === null ? null : quantityPlanFor(pending.action);

  /**
   * A quantity is valid when it is a whole, non-negative multiple of the pack.
   *
   * LTN4 picks and ships full boxes, so a figure that is not a multiple of the
   * VPE is a quantity nobody can fulfil exactly. The server rounds up anyway;
   * refusing here means the storekeeper sees the real number before they commit
   * rather than a corrected one afterwards.
   */
  const invalidLine = (line: RequestLineItem): string | null => {
    const raw = quantities[line.id] ?? "";
    if (raw.trim() === "") return "Quantite requise";

    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) return "Nombre entier positif attendu";
    if (value % line.vpeSnapshot !== 0) {
      return `Multiple de ${formatQuantity(line.vpeSnapshot)} (VPE) attendu`;
    }
    return null;
  };

  const reasonMissing = pending?.requiresReason === true && reason.trim().length < 10;
  const quantitiesInvalid = plan !== null && lines.some((line) => invalidLine(line) !== null);
  const cannotConfirm = transition.isPending || reasonMissing || quantitiesInvalid;

  const confirm = () => {
    if (pending === null) return;

    transition.mutate({
      requestId,
      action: pending.action,
      ...(pending.requiresReason ? { reason } : {}),
      ...(plan === null
        ? {}
        : {
            lines: lines.map((line) => ({
              lineId: line.id,
              quantity: Number(quantities[line.id] ?? "0"),
            })),
          }),
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
              open(action);
            }}
          >
            {REQUEST_ACTION_LABELS_FR[action.action]}
          </Button>
        ))}
      </div>

      {pending !== null && (
        <Dialog
          open
          onClose={close}
          title={REQUEST_ACTION_LABELS_FR[pending.action]}
          description={
            plan === null
              ? "Cette action doit etre justifiee. Le motif est conserve dans l historique de la demande."
              : "Ajustez les quantites si elles different de l etape precedente. Un ecart est conserve dans l historique."
          }
          footer={
            <>
              <Button variant="outline" disabled={transition.isPending} onClick={close}>
                Annuler
              </Button>
              <Button disabled={cannotConfirm} onClick={confirm}>
                {transition.isPending ? "Enregistrement..." : "Confirmer"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {plan !== null && (
              <div className="space-y-3">
                {lines.map((line) => {
                  const error = invalidLine(line);

                  return (
                    <div key={line.id} className="space-y-1.5">
                      <Label htmlFor={`quantity-${line.id}`}>
                        {line.reference} — {line.designation}
                      </Label>
                      <Input
                        id={`quantity-${line.id}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={line.vpeSnapshot}
                        className="tabular"
                        value={quantities[line.id] ?? ""}
                        onChange={(event) => {
                          setQuantities((previous) => ({
                            ...previous,
                            [line.id]: event.target.value,
                          }));
                        }}
                      />
                      <p
                        className={
                          error === null
                            ? "text-xs text-foreground-muted"
                            : "text-xs text-status-critical"
                        }
                      >
                        {error ??
                          `Demande : ${formatQuantity(line.requestedQuantity)} · VPE : ${formatQuantity(line.vpeSnapshot)}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {pending.requiresReason && (
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
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
