"use client";

import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PRIORITY_LABELS_FR, type RequestDetail } from "@leoni/contracts";
import { REQUEST_PRIORITIES, type RequestPriority } from "@leoni/core";
import {
  Button,
  ConfirmButton,
  Field,
  formatQuantity,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericHead,
  TableRow,
  useToast,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface DraftEditorProps {
  readonly request: RequestDetail;
}

interface DraftLine {
  readonly articleId: string;
  readonly reference: string;
  readonly designation: string;
  readonly quantity: string;
}

/** A date input wants `YYYY-MM-DD`, and a Date does not stringify that way. */
function toDateInput(value: Date | null): string {
  return value === null ? "" : value.toISOString().slice(0, 10);
}

/**
 * Correcting a draft before it is submitted.
 *
 * Only rendered while the status is `DRAFT`. Before this existed, a typo could
 * only be resolved by cancelling the request with a ten-character written
 * justification — which put a fictional reason in the audit trail for something
 * that never entered the process.
 */
export function DraftEditor({ request }: DraftEditorProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const [priority, setPriority] = useState<RequestPriority>(request.priority);
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(
    toDateInput(request.expectedDeliveryAt),
  );
  const [lines, setLines] = useState<readonly DraftLine[]>(
    request.lines.map((line) => ({
      articleId: line.articleId,
      reference: line.reference,
      designation: line.designation,
      quantity: String(line.requestedQuantity),
    })),
  );

  const save = useMutation(
    trpc.request.updateDraft.mutationOptions({
      onSuccess: () => {
        toast.success("Brouillon enregistre", "Les quantites ont ete arrondies au multiple de VPE.");
        router.refresh();
      },
      onError: (cause) => {
        toast.error("Enregistrement refuse", cause.message);
      },
    }),
  );

  const discard = useMutation(
    trpc.request.deleteDraft.mutationOptions({
      onSuccess: () => {
        toast.success("Brouillon supprime");
        router.push("/demandes");
      },
      onError: (cause) => {
        toast.error("Suppression refusee", cause.message);
      },
    }),
  );

  const submit = () => {
    const payload = lines
      .map((line) => ({ articleId: line.articleId, requestedQuantity: Number(line.quantity) }))
      .filter((line) => Number.isFinite(line.requestedQuantity) && line.requestedQuantity > 0);

    if (payload.length === 0) {
      toast.error(
        "Demande incomplete",
        "Gardez au moins une ligne avec une quantite superieure a zero.",
      );
      return;
    }

    save.mutate({
      requestId: request.id,
      priority,
      lines: payload,
      expectedDeliveryAt: expectedDeliveryAt === "" ? null : new Date(expectedDeliveryAt),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Priorite" className="w-48">
          {(props) => (
            <Select
              {...props}
              value={priority}
              onChange={(event) => {
                const next = REQUEST_PRIORITIES.find(
                  (candidate) => candidate === event.target.value,
                );
                setPriority(next ?? "NORMAL");
              }}
            >
              {REQUEST_PRIORITIES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {PRIORITY_LABELS_FR[candidate]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Livraison souhaitee" className="w-48">
          {(props) => (
            <Input
              {...props}
              type="date"
              value={expectedDeliveryAt}
              onChange={(event) => {
                setExpectedDeliveryAt(event.target.value);
              }}
            />
          )}
        </Field>
      </div>

      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Designation</TableHead>
              <TableNumericHead>Quantite demandee</TableNumericHead>
              <TableHead className="w-10" aria-label="Retirer" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.articleId}>
                <TableCell className="font-medium whitespace-nowrap">{line.reference}</TableCell>
                <TableCell className="max-w-56 truncate">{line.designation}</TableCell>
                <TableCell className="w-36">
                  <Input
                    type="number"
                    min={0}
                    aria-label={`Quantite pour ${line.reference}`}
                    value={line.quantity}
                    onChange={(event) => {
                      const next = event.target.value;
                      setLines((previous) =>
                        previous.map((candidate) =>
                          candidate.articleId === line.articleId
                            ? { ...candidate, quantity: next }
                            : candidate,
                        ),
                      );
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Retirer ${line.reference}`}
                    onClick={() => {
                      setLines((previous) =>
                        previous.filter((candidate) => candidate.articleId !== line.articleId),
                      );
                    }}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <p className="text-xs text-foreground-muted">
        Total demande : {formatQuantity(lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0))} unites,
        avant arrondi au multiple de VPE.
      </p>

      <div className="flex flex-wrap justify-between gap-2">
        <ConfirmButton
          confirmTitle={`Supprimer le brouillon ${request.code} ?`}
          confirmDescription="Le brouillon et ses lignes seront effaces. Une demande deja soumise ne se supprime pas : elle s annule avec un motif."
          confirmLabel="Supprimer"
          isPending={discard.isPending}
          onConfirm={() => {
            discard.mutate({ requestId: request.id });
          }}
        >
          <Trash2 />
          Supprimer le brouillon
        </ConfirmButton>

        <Button disabled={save.isPending} onClick={submit}>
          {save.isPending ? "Enregistrement..." : "Enregistrer le brouillon"}
        </Button>
      </div>
    </div>
  );
}
