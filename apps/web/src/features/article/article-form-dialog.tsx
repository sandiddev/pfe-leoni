"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ABC_CLASS_LABELS_FR, type ArticleListItem } from "@leoni/contracts";
import { ABC_CLASSES, type AbcClass } from "@leoni/core";
import { Button, Dialog, Field, Input, Select, Switch, useToast } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface ArticleFormDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Omitted to create; supplied to edit. */
  readonly article?: ArticleListItem;
  readonly onSaved?: () => void;
}

/**
 * Creating or editing an article.
 *
 * One dialog for both, because the fields are the same set minus the reference
 * — which is the article's identity and is therefore fixed once created. Two
 * dialogs would be two places to add the next master-data field to.
 *
 * Changing the lead time or the ABC class invalidates the stored thresholds;
 * the server says so in its result and the toast passes that on, rather than
 * silently leaving figures that no longer describe the article.
 */
export function ArticleFormDialog({ open, onClose, article, onSaved }: ArticleFormDialogProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const isEdit = article !== undefined;

  const [reference, setReference] = useState(article?.reference ?? "");
  const [designation, setDesignation] = useState(article?.designation ?? "");
  const [vpe, setVpe] = useState(String(article?.vpe ?? 100));
  const [leadTimeDays, setLeadTimeDays] = useState(String(article?.leadTimeDays ?? 2));
  const [abcClass, setAbcClass] = useState<AbcClass>(article?.abcClass ?? "C");
  const [isActive, setIsActive] = useState(article?.isActive ?? true);
  const [initialStock, setInitialStock] = useState("0");

  const done = () => {
    onSaved?.();
    router.refresh();
    onClose();
  };

  const create = useMutation(
    trpc.article.create.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          `Article ${result.reference} cree`,
          "Il est suivi sur les deux sites. Lancez un recalcul pour lui donner des seuils.",
        );
        done();
      },
      onError: (cause) => {
        toast.error("Creation refusee", cause.message);
      },
    }),
  );

  const update = useMutation(
    trpc.article.update.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          "Article mis a jour",
          result.thresholdsNeedRecalculation
            ? "Le delai ou la classe a change : relancez un recalcul pour mettre les seuils a jour."
            : undefined,
        );
        done();
      },
      onError: (cause) => {
        toast.error("Modification refusee", cause.message);
      },
    }),
  );

  const isPending = create.isPending || update.isPending;

  const submit = () => {
    const parsedVpe = Number(vpe);
    const parsedLeadTime = Number(leadTimeDays);

    if (designation.trim().length < 2 || !Number.isFinite(parsedVpe) || parsedVpe <= 0) {
      toast.error("Saisie incomplete", "Une designation et une VPE superieure a zero sont requises.");
      return;
    }

    if (isEdit) {
      update.mutate({
        articleId: article.articleId,
        designation,
        vpe: parsedVpe,
        leadTimeDays: parsedLeadTime,
        abcClass,
        isActive,
      });
      return;
    }

    create.mutate({
      reference,
      designation,
      vpe: parsedVpe,
      leadTimeDays: parsedLeadTime,
      abcClass,
      initialStock: Number(initialStock) || 0,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? `Modifier ${article.reference}` : "Nouvel article"}
      description={
        isEdit
          ? "La reference ne se modifie pas : c est l identite lue sur l etiquette du bac."
          : "L article est cree sur les deux sites. Ses seuils restent a zero jusqu au premier recalcul."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Enregistrement..." : isEdit ? "Enregistrer" : "Creer l article"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!isEdit && (
          <Field
            label="Reference"
            required
            description="Mise en majuscules automatiquement. Doit etre unique dans le catalogue."
          >
            {(props) => (
              <Input
                {...props}
                value={reference}
                placeholder="REF-0042"
                onChange={(event) => {
                  setReference(event.target.value);
                }}
              />
            )}
          </Field>
        )}

        <Field label="Designation" required>
          {(props) => (
            <Input
              {...props}
              value={designation}
              placeholder="Connecteur 4 voies"
              onChange={(event) => {
                setDesignation(event.target.value);
              }}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="VPE"
            required
            description="Taille du conditionnement. Toute commande en est un multiple."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={1}
                value={vpe}
                onChange={(event) => {
                  setVpe(event.target.value);
                }}
              />
            )}
          </Field>

          <Field
            label="Delai de livraison (jours)"
            required
            description="Delai LTN4. Il entre directement dans le seuil mini."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                value={leadTimeDays}
                onChange={(event) => {
                  setLeadTimeDays(event.target.value);
                }}
              />
            )}
          </Field>
        </div>

        <Field
          label="Classe ABC"
          description="Decide des parametres de securite et de couverture appliques."
        >
          {(props) => (
            <Select
              {...props}
              value={abcClass}
              onChange={(event) => {
                const next = ABC_CLASSES.find((candidate) => candidate === event.target.value);
                setAbcClass(next ?? "C");
              }}
            >
              {ABC_CLASSES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {ABC_CLASS_LABELS_FR[candidate]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {isEdit ? (
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Article actif</p>
              <p className="text-xs text-foreground-muted">
                Un article archive disparait des ecrans mais reste lisible sur les demandes
                cloturees.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Article actif" />
          </div>
        ) : (
          <Field
            label="Stock initial par site"
            description="Ecrit directement, sans mouvement : une quantite d ouverture n est pas une entree."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                value={initialStock}
                onChange={(event) => {
                  setInitialStock(event.target.value);
                }}
              />
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}
