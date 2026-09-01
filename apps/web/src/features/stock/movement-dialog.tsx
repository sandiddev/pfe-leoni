"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { MOVEMENT_TYPE_LABELS_FR, type StorageLocationOption } from "@leoni/contracts";
import { Button, Dialog, Input, Label, Select, Textarea, useToast } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

/** The four movements a storekeeper records. An inventory count is separate. */
const RECORDABLE_TYPES = ["ENTRY", "EXIT", "TRANSFER_IN", "TRANSFER_OUT"] as const;
type RecordableType = (typeof RECORDABLE_TYPES)[number];

const INBOUND: readonly RecordableType[] = ["ENTRY", "TRANSFER_IN"];

export interface MovementDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onRecorded: () => void;
  readonly locations: readonly StorageLocationOption[];
  /** Inventory count instead of a movement: different permission, needs a reason. */
  readonly mode: "move" | "adjust";
}

/**
 * Records a movement, or an inventory count.
 *
 * One dialog for both because the operator's task is the same — name an
 * article, name a quantity, say where — and the difference is two fields. The
 * two API procedures stay separate, because their permissions are.
 */
export function MovementDialog({
  open,
  onClose,
  onRecorded,
  locations,
  mode,
}: MovementDialogProps) {
  const trpc = useTRPC();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [articleId, setArticleId] = useState("");
  const [type, setType] = useState<RecordableType>("ENTRY");
  const [quantity, setQuantity] = useState("");
  const [locationId, setLocationId] = useState("");
  const [reference, setReference] = useState("");
  const [batchReference, setBatchReference] = useState("");
  const [supplierReference, setSupplierReference] = useState("");
  const [reason, setReason] = useState("");

  const articles = useQuery(
    trpc.article.list.queryOptions({
      limit: 20,
      includeInactive: false,
      onlyReplenishable: false,
      sortBy: "reference",
      sortDirection: "asc",
      ...(search === "" ? {} : { search }),
    }),
  );

  const needsLocation = mode === "adjust" || INBOUND.includes(type);

  const reset = () => {
    setArticleId("");
    setQuantity("");
    setReference("");
    setReason("");
  };

  const succeed = (result: { previousStock: number; newStock: number }) => {
    reset();
    // The two figures are the whole confirmation: a storekeeper needs to see
    // that the level moved the way they expected, not just that a form closed.
    toast.success(
      "Mouvement enregistre",
      `Stock : ${String(result.previousStock)} -> ${String(result.newStock)} unites.`,
    );
    onRecorded();
    onClose();
  };

  const fail = (cause: { message: string }) => {
    toast.error("Mouvement refuse", cause.message);
  };

  const record = useMutation(
    trpc.stock.record.mutationOptions({ onSuccess: succeed, onError: fail }),
  );
  const adjust = useMutation(
    trpc.stock.adjust.mutationOptions({ onSuccess: succeed, onError: fail }),
  );

  const isPending = record.isPending || adjust.isPending;

  const submit = () => {
    const parsedQuantity = Number(quantity);

    if (articleId === "" || !Number.isFinite(parsedQuantity)) {
      toast.error("Saisie incomplete", "Selectionnez un article et saisissez une quantite.");
      return;
    }

    if (mode === "adjust") {
      adjust.mutate({
        articleId,
        countedQuantity: parsedQuantity,
        reason,
        ...(locationId === "" ? {} : { storageLocationId: locationId }),
      });
      return;
    }

    record.mutate({
      articleId,
      type,
      quantity: parsedQuantity,
      ...(locationId === "" ? {} : { storageLocationId: locationId }),
      ...(reference === "" ? {} : { reference }),
      ...(batchReference === "" ? {} : { batchReference }),
      ...(supplierReference === "" ? {} : { supplierReference }),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "adjust" ? "Saisir un inventaire" : "Saisir un mouvement"}
      description={
        mode === "adjust"
          ? "La quantite comptee remplace le niveau enregistre. Le motif est obligatoire."
          : "Le mouvement est enregistre dans le journal et met a jour le stock."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="movement-search">Rechercher un article</Label>
          <Input
            id="movement-search"
            placeholder="Reference ou designation"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="movement-article">Article</Label>
          <Select
            id="movement-article"
            value={articleId}
            onChange={(event) => {
              setArticleId(event.target.value);
            }}
          >
            <option value="">Selectionner un article</option>
            {(articles.data?.items ?? []).map((item) => (
              <option key={item.articleId} value={item.articleId}>
                {item.reference} — {item.designation} (stock {item.currentStock})
              </option>
            ))}
          </Select>
        </div>

        {mode === "move" && (
          <div className="space-y-1.5">
            <Label htmlFor="movement-type">Type de mouvement</Label>
            <Select
              id="movement-type"
              value={type}
              onChange={(event) => {
                const next = RECORDABLE_TYPES.find(
                  (candidate) => candidate === event.target.value,
                );
                setType(next ?? "ENTRY");
              }}
            >
              {RECORDABLE_TYPES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {MOVEMENT_TYPE_LABELS_FR[candidate]}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="movement-quantity">
            {mode === "adjust" ? "Quantite comptee" : "Quantite"}
          </Label>
          <Input
            id="movement-quantity"
            type="number"
            min={0}
            step={1}
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
          />
        </div>

        {needsLocation && (
          <div className="space-y-1.5">
            <Label htmlFor="movement-location">
              Emplacement {mode === "adjust" && "(si la quantite comptee est superieure)"}
            </Label>
            <Select
              id="movement-location"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
              }}
            >
              <option value="">Selectionner un emplacement</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code}
                  {location.description === null ? "" : ` — ${location.description}`}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* Only on an inbound movement. A batch is a property of stock
            arriving; on an exit FIFO decides which batches leave, so asking
            here would invite a picker to name a lot they did not draw from. */}
        {mode === "move" && INBOUND.includes(type) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="movement-batch">Lot fournisseur</Label>
              <Input
                id="movement-batch"
                placeholder="LOT-2026-014"
                value={batchReference}
                onChange={(event) => {
                  setBatchReference(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="movement-supplier">Fournisseur</Label>
              <Input
                id="movement-supplier"
                placeholder="TE Connectivity"
                value={supplierReference}
                onChange={(event) => {
                  setSupplierReference(event.target.value);
                }}
              />
            </div>
          </div>
        )}

        {mode === "move" ? (
          <div className="space-y-1.5">
            <Label htmlFor="movement-reference">Reference (bon de livraison, demande)</Label>
            <Input
              id="movement-reference"
              value={reference}
              onChange={(event) => {
                setReference(event.target.value);
              }}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="movement-reason">Motif de l ajustement</Label>
            <Textarea
              id="movement-reason"
              placeholder="Ecart constate lors de l inventaire tournant du..."
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </div>
        )}

      </div>
    </Dialog>
  );
}
