"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { type AlertBoardItem, PRIORITY_LABELS_FR } from "@leoni/contracts";
import { REQUEST_PRIORITIES, type RequestPriority } from "@leoni/core";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  formatQuantity,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericCell,
  TableNumericHead,
  TableRow,
  useToast,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface NewRequestFormProps {
  /** Articles carried over from the alert board, already assessed. */
  readonly prefill: readonly AlertBoardItem[];
  /** Everything selectable, so a line can be added without leaving the form. */
  readonly catalogue: readonly AlertBoardItem[];
}

interface DraftLine {
  readonly articleId: string;
  readonly quantity: string;
}

/**
 * The line editor.
 *
 * Each row shows the suggested quantity next to the one being requested, so the
 * gap between them is visible while it is being created rather than only in the
 * KPI that measures it afterwards.
 */
export function NewRequestForm({ prefill, catalogue }: NewRequestFormProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const [priority, setPriority] = useState<RequestPriority>("NORMAL");
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState("");
  const [lines, setLines] = useState<readonly DraftLine[]>(
    prefill.map((item) => ({
      articleId: item.articleId,
      quantity: String(item.recommendedQuantity > 0 ? item.recommendedQuantity : item.vpe),
    })),
  );

  const byArticleId = new Map(catalogue.map((item) => [item.articleId, item]));

  const create = useMutation(
    trpc.request.create.mutationOptions({
      onSuccess: (result) => {
        toast.success(`Demande ${result.code} creee`, "Elle est en brouillon : soumettez-la pour lancer la validation.");
        router.push(`/demandes/${result.requestId}`);
      },
      onError: (cause) => {
        toast.error("La demande n a pas pu etre creee", cause.message);
      },
    }),
  );

  const setQuantity = (articleId: string, quantity: string) => {
    setLines((previous) =>
      previous.map((line) => (line.articleId === articleId ? { ...line, quantity } : line)),
    );
  };

  const removeLine = (articleId: string) => {
    setLines((previous) => previous.filter((line) => line.articleId !== articleId));
  };

  const addLine = (articleId: string) => {
    if (articleId === "" || lines.some((line) => line.articleId === articleId)) return;
    const item = byArticleId.get(articleId);
    setLines((previous) => [
      ...previous,
      {
        articleId,
        quantity: String(item !== undefined && item.recommendedQuantity > 0 ? item.recommendedQuantity : (item?.vpe ?? 1)),
      },
    ]);
  };

  const submit = () => {
    const payload = lines
      .map((line) => ({ articleId: line.articleId, requestedQuantity: Number(line.quantity) }))
      .filter((line) => Number.isFinite(line.requestedQuantity) && line.requestedQuantity > 0);

    if (payload.length === 0) {
      toast.error(
        "Demande incomplete",
        "Ajoutez au moins une ligne avec une quantite superieure a zero.",
      );
      return;
    }

    create.mutate({
      priority,
      lines: payload,
      ...(expectedDeliveryAt === ""
        ? {}
        : { expectedDeliveryAt: new Date(expectedDeliveryAt) }),
    });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="request-priority">Priorite</Label>
            <Select
              id="request-priority"
              className="w-48"
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="request-delivery">Livraison souhaitee</Label>
            <Input
              id="request-delivery"
              type="date"
              className="w-48"
              value={expectedDeliveryAt}
              onChange={(event) => {
                setExpectedDeliveryAt(event.target.value);
              }}
            />
          </div>

          <div className="min-w-64 flex-1 space-y-1.5">
            <Label htmlFor="request-add">Ajouter un article</Label>
            <Select
              id="request-add"
              value=""
              onChange={(event) => {
                addLine(event.target.value);
              }}
            >
              <option value="">Selectionner un article</option>
              {catalogue.map((item) => (
                <option key={item.articleId} value={item.articleId}>
                  {item.reference} — {item.designation}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {lines.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="Aucune ligne"
          description="Ajoutez un article ci-dessus, ou repartez du tableau des alertes pour preremplir la demande."
        />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Designation</TableHead>
                <TableNumericHead>Stock</TableNumericHead>
                <TableNumericHead>Seuil maxi</TableNumericHead>
                <TableNumericHead>VPE</TableNumericHead>
                <TableNumericHead>Qte preconisee</TableNumericHead>
                <TableNumericHead>Qte demandee</TableNumericHead>
                <TableHead className="w-10" aria-label="Retirer" />
              </TableRow>
            </TableHeader>

            <TableBody>
              {lines.map((line) => {
                const item = byArticleId.get(line.articleId);

                return (
                  <TableRow key={line.articleId}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {item?.reference ?? line.articleId}
                    </TableCell>
                    <TableCell className="max-w-56 truncate">{item?.designation ?? "—"}</TableCell>
                    <TableNumericCell>{formatQuantity(item?.currentStock ?? 0)}</TableNumericCell>
                    <TableNumericCell className="text-foreground-muted">
                      {formatQuantity(item?.maxThreshold ?? 0)}
                    </TableNumericCell>
                    <TableNumericCell className="text-foreground-muted">
                      {formatQuantity(item?.vpe ?? 0)}
                    </TableNumericCell>
                    <TableNumericCell
                      title={
                        item === undefined
                          ? undefined
                          : `Besoin ${formatQuantity(item.need)}, soit ${formatQuantity(item.boxCount)} boite(s) de ${formatQuantity(item.vpe)}`
                      }
                    >
                      {formatQuantity(item?.recommendedQuantity ?? 0)}
                    </TableNumericCell>
                    <TableCell className="w-32">
                      <Input
                        type="number"
                        min={0}
                        step={item?.vpe ?? 1}
                        aria-label={`Quantite demandee pour ${item?.reference ?? line.articleId}`}
                        value={line.quantity}
                        onChange={(event) => {
                          setQuantity(line.articleId, event.target.value);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Retirer ${item?.reference ?? line.articleId}`}
                        onClick={() => {
                          removeLine(line.articleId);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}


      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            router.push("/alertes");
          }}
        >
          Annuler
        </Button>
        <Button onClick={submit} disabled={create.isPending || lines.length === 0}>
          {create.isPending ? "Creation..." : "Creer la demande"}
        </Button>
      </div>
    </div>
  );
}
