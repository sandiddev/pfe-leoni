"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ABC_CLASS_LABELS_FR } from "@leoni/contracts";
import { AVERAGING_WINDOWS } from "@leoni/core";
import {
  Badge,
  Button,
  ConfirmButton,
  Field,
  Input,
  Select,
  Spinner,
  useToast,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface ArticleParametersProps {
  readonly articleId: string;
  readonly canWrite: boolean;
}

/**
 * The parameters that govern one article (brief section 3.4).
 *
 * An article-level row overrides its class defaults, which is how a single
 * critical reference gets a wider safety margin without moving the whole class.
 * The badge says which of the two is in force, because "clear the override" is
 * only a meaningful action when there is one.
 */
export function ArticleParameters({ articleId, canWrite }: ArticleParametersProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const query = useQuery(trpc.parameter.forArticle.queryOptions({ articleId }));

  const [draft, setDraft] = useState<{
    safetyDays: string;
    extraCoverageDays: string;
    averagingWindowDays: number;
    marginPercent: string;
  } | null>(null);

  // The form is seeded from whatever is currently in force — an override if one
  // exists, the class defaults otherwise, so "override this" starts from the
  // numbers the user is looking at rather than from zero.
  const values = draft ?? {
    safetyDays: String(query.data?.safetyDays ?? 0),
    extraCoverageDays: String(query.data?.extraCoverageDays ?? 0),
    averagingWindowDays: query.data?.averagingWindowDays ?? 30,
    marginPercent: String(Math.round((query.data?.warningMarginRatio ?? 0.2) * 100)),
  };

  const refresh = () => {
    setDraft(null);
    void query.refetch();
    router.refresh();
  };

  const save = useMutation(
    trpc.parameter.upsertForArticle.mutationOptions({
      onSuccess: () => {
        toast.success(
          "Parametres propres enregistres",
          "Lancez un recalcul pour appliquer les nouveaux seuils a cet article.",
        );
        refresh();
      },
      onError: (cause) => {
        toast.error("Enregistrement refuse", cause.message);
      },
    }),
  );

  const clear = useMutation(
    trpc.parameter.clearForArticle.mutationOptions({
      onSuccess: () => {
        toast.success("Override supprime", "L article suit de nouveau les valeurs de sa classe.");
        refresh();
      },
      onError: (cause) => {
        toast.error("Suppression refusee", cause.message);
      },
    }),
  );

  if (query.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-foreground-muted">
        <Spinner />
        Chargement des parametres...
      </p>
    );
  }

  const isOverridden = query.data?.source === "ARTICLE";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isOverridden ? "primary" : "outline"}>
          {isOverridden ? "Parametres propres a cet article" : "Valeurs de la classe"}
        </Badge>
        {query.data !== undefined && (
          <span className="text-sm text-foreground-muted">
            {ABC_CLASS_LABELS_FR[query.data.abcClass]}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Jours de securite">
          {(props) => (
            <Input
              {...props}
              type="number"
              min={0}
              step={0.5}
              disabled={!canWrite}
              value={values.safetyDays}
              onChange={(event) => {
                setDraft({ ...values, safetyDays: event.target.value });
              }}
            />
          )}
        </Field>

        <Field label="Couverture additionnelle">
          {(props) => (
            <Input
              {...props}
              type="number"
              min={0}
              step={0.5}
              disabled={!canWrite}
              value={values.extraCoverageDays}
              onChange={(event) => {
                setDraft({ ...values, extraCoverageDays: event.target.value });
              }}
            />
          )}
        </Field>

        <Field label="Fenetre de moyenne">
          {(props) => (
            <Select
              {...props}
              disabled={!canWrite}
              value={String(values.averagingWindowDays)}
              onChange={(event) => {
                const next = AVERAGING_WINDOWS.find(
                  (candidate) => String(candidate) === event.target.value,
                );
                setDraft({ ...values, averagingWindowDays: next ?? 30 });
              }}
            >
              {AVERAGING_WINDOWS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate} jours
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Marge d alerte (%)">
          {(props) => (
            <Input
              {...props}
              type="number"
              min={0}
              max={100}
              step={5}
              disabled={!canWrite}
              value={values.marginPercent}
              onChange={(event) => {
                setDraft({ ...values, marginPercent: event.target.value });
              }}
            />
          )}
        </Field>
      </div>

      {canWrite && (
        <div className="flex flex-wrap justify-between gap-2">
          {isOverridden ? (
            <ConfirmButton
              variant="outline"
              confirmTitle="Revenir aux valeurs de la classe ?"
              confirmDescription="Les parametres propres a cet article seront supprimes et il suivra de nouveau sa classe ABC. L operation est tracee dans le journal."
              confirmLabel="Supprimer l override"
              isPending={clear.isPending}
              onConfirm={() => {
                clear.mutate({ articleId });
              }}
            >
              <RotateCcw />
              Revenir a la classe
            </ConfirmButton>
          ) : (
            <span />
          )}

          <Button
            disabled={save.isPending}
            onClick={() => {
              const window = values.averagingWindowDays;

              save.mutate({
                articleId,
                safetyDays: Number(values.safetyDays),
                extraCoverageDays: Number(values.extraCoverageDays),
                averagingWindowDays: window === 7 || window === 90 ? window : 30,
                warningMarginRatio: Number(values.marginPercent) / 100,
              });
            }}
          >
            {save.isPending ? "Enregistrement..." : "Appliquer a cet article"}
          </Button>
        </div>
      )}
    </div>
  );
}
