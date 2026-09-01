"use client";

import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  type ParameterItem,
  RECALCULATION_TRIGGER_LABELS_FR,
  type RecalculationHistoryItem,
  type RecalculationResult,
} from "@leoni/contracts";
import type { AbcClass } from "@leoni/core";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  formatDateTime,
  formatDecimal,
  formatQuantity,
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

import { ParameterRow } from "./parameter-row";

export interface ParameterPanelProps {
  readonly parameters: readonly ParameterItem[];
  readonly history: readonly RecalculationHistoryItem[];
  readonly canEdit: boolean;
  readonly canRecalculate: boolean;
}

/**
 * The parameters screen: the four tunable numbers, and the recalculation.
 *
 * Editing a parameter does not rewrite the stored thresholds. That is
 * deliberate: rewriting a thousand rows inside a form submission would make the
 * edit slow and hard to undo, and would leave the administrator unable to see
 * what their change did before it took effect. The banner below says so, and
 * the recalculation is one button away.
 */
export function ParameterPanel({
  parameters,
  history,
  canEdit,
  canRecalculate,
}: ParameterPanelProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();

  const describe = (result: RecalculationResult) =>
    `${formatQuantity(result.evaluated)} article(s) evalues, ${formatQuantity(result.changed)} seuil(s) modifie(s), ` +
    `${formatQuantity(result.nowCritical)} au niveau ou sous le seuil mini.`;

  const update = useMutation(
    trpc.parameter.update.mutationOptions({
      onSuccess: (result: { abcClass: AbcClass }) => {
        toast.success(
          `Classe ${result.abcClass} enregistree`,
          "Lancez un recalcul pour appliquer les nouveaux seuils aux articles.",
        );
        router.refresh();
      },
      onError: (cause) => {
        toast.error("Enregistrement refuse", cause.message);
      },
    }),
  );

  const recalculate = useMutation(
    trpc.parameter.recalculate.mutationOptions({
      onSuccess: (result) => {
        toast.success("Recalcul termine", describe(result));
        router.refresh();
      },
      onError: (cause) => {
        toast.error("Le recalcul a echoue", cause.message);
      },
    }),
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Parametres par classe ABC</CardTitle>
            <CardDescription>
              Ces valeurs alimentent chaque seuil calcule. Une classe sans ligne enregistree
              fonctionne sur les valeurs par defaut du domaine.
            </CardDescription>
          </div>
          {canRecalculate && (
            <Button
              disabled={recalculate.isPending}
              onClick={() => {
                recalculate.mutate({});
              }}
            >
              <RefreshCw />
              {recalculate.isPending ? "Recalcul en cours..." : "Recalculer les seuils"}
            </Button>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Classe</TableHead>
                  <TableHead>Jours de securite</TableHead>
                  <TableHead>Couverture additionnelle</TableHead>
                  <TableHead>Fenetre de moyenne</TableHead>
                  <TableHead>Marge d alerte (%)</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {parameters.map((parameter) => (
                  <ParameterRow
                    key={parameter.abcClass}
                    parameter={parameter}
                    canEdit={canEdit}
                    isSaving={update.isPending}
                    onSave={(values) => {
                      update.mutate({ abcClass: parameter.abcClass, ...values });
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historique des recalculs</CardTitle>
          <CardDescription>
            Chaque ligne conserve les parametres en vigueur au moment du calcul, afin qu un seuil
            puisse etre explique apres coup (section 3.5).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              Aucun recalcul enregistre. Lancez-en un pour alimenter cet historique.
            </p>
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Site</TableHead>
                    <TableNumericHead>Conso./jour</TableNumericHead>
                    <TableNumericHead>Securite</TableNumericHead>
                    <TableNumericHead>Seuil mini</TableNumericHead>
                    <TableNumericHead>Seuil maxi</TableNumericHead>
                    <TableHead>Declencheur</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {history.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-foreground-muted">
                        {formatDateTime(entry.computedAt)}
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        {entry.reference}
                      </TableCell>
                      <TableCell className="text-foreground-muted">{entry.siteCode}</TableCell>
                      <TableNumericCell>
                        {formatDecimal(entry.averageDailyConsumption)}
                      </TableNumericCell>
                      <TableNumericCell className="text-foreground-muted">
                        {formatQuantity(entry.safetyStock)}
                      </TableNumericCell>
                      <TableNumericCell>{formatQuantity(entry.minThreshold)}</TableNumericCell>
                      <TableNumericCell>{formatQuantity(entry.maxThreshold)}</TableNumericCell>
                      <TableCell>
                        <Badge variant="outline">
                          {RECALCULATION_TRIGGER_LABELS_FR[entry.trigger]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
