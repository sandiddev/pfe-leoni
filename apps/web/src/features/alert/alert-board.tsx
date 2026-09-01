"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, ClipboardPlus, OctagonX, ShieldCheck, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ABC_CLASS_LABELS_FR,
  ALERT_LEVEL_LABELS_FR,
  type AlertBoardItem,
  type AlertSummary,
} from "@leoni/contracts";
import { ABC_CLASSES, type AbcClass, ALERT_LEVELS, type AlertLevel } from "@leoni/core";
import {
  Button,
  DataTableShell,
  formatQuantity,
  Select,
  StatCard,
  Table,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericHead,
  TableRow,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

import { AlertRows } from "./alert-rows";

export interface AlertBoardProps {
  /** Fetched on the server so the first paint has rows, not a spinner. */
  readonly initialItems: readonly AlertBoardItem[];
  readonly totalCount: number;
  readonly summary: AlertSummary;
  readonly canCreateRequest: boolean;
}

const TILES = [
  { level: "RUPTURE", icon: OctagonX, tone: "rupture", hint: "Ligne de production exposee" },
  { level: "CRITICAL", icon: CircleAlert, tone: "critical", hint: "Au niveau ou sous le seuil mini" },
  { level: "WARNING", icon: TriangleAlert, tone: "warning", hint: "Approche du seuil mini" },
  { level: "NORMAL", icon: ShieldCheck, tone: "normal", hint: "Aucune action requise" },
] as const;

/**
 * The alert board: severity tiles, the table, and the action that matters.
 *
 * Selecting rows and pressing "Creer une demande" carries the article ids into
 * the request form, which prefills each line with the quantity the domain
 * proposed. That hand-off is the point of the screen — a board that only
 * informs leaves the storekeeper to retype what it just computed.
 */
export function AlertBoard({
  initialItems,
  totalCount,
  summary,
  canCreateRequest,
}: AlertBoardProps) {
  const trpc = useTRPC();
  const router = useRouter();

  const [level, setLevel] = useState<AlertLevel | "ALL">("ALL");
  const [abcClass, setAbcClass] = useState<AbcClass | "ALL">("ALL");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const isFiltered = level !== "ALL" || abcClass !== "ALL";

  const query = useQuery(
    trpc.alert.board.queryOptions({
      limit: 50,
      includeNormal: level === "NORMAL",
      ...(level === "ALL" ? {} : { level }),
      ...(abcClass === "ALL" ? {} : { abcClass }),
    }),
  );

  const items = query.data?.items ?? (isFiltered ? [] : initialItems);
  const shownCount = query.data?.totalCount ?? totalCount;

  const toggle = (articleId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(articleId)) next.delete(articleId);
      else next.add(articleId);
      return next;
    });
  };

  const selectAllNeeded = () => {
    setSelected(new Set(items.filter((item) => item.isReplenishmentNeeded).map((i) => i.articleId)));
  };

  const createRequest = () => {
    router.push(`/demandes/nouvelle?articles=${[...selected].join(",")}`);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TILES.map((tile) => (
          <StatCard
            key={tile.level}
            label={ALERT_LEVEL_LABELS_FR[tile.level]}
            value={summary[tile.level]}
            icon={tile.icon}
            tone={tile.tone}
            hint={tile.hint}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Filtrer par severite">
          <Button
            size="sm"
            variant={level === "ALL" ? "primary" : "outline"}
            aria-pressed={level === "ALL"}
            onClick={() => {
              setLevel("ALL");
            }}
          >
            A traiter
          </Button>
          {ALERT_LEVELS.map((candidate) => (
            <Button
              key={candidate}
              size="sm"
              variant={level === candidate ? "primary" : "outline"}
              aria-pressed={level === candidate}
              onClick={() => {
                setLevel(candidate);
              }}
            >
              {ALERT_LEVEL_LABELS_FR[candidate]}
            </Button>
          ))}

          <Select
            className="ml-2 w-44"
            aria-label="Filtrer par classe ABC"
            value={abcClass}
            onChange={(event) => {
              const next = ABC_CLASSES.find((candidate) => candidate === event.target.value);
              setAbcClass(next ?? "ALL");
            }}
          >
            <option value="ALL">Toutes les classes</option>
            {ABC_CLASSES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {ABC_CLASS_LABELS_FR[candidate]}
              </option>
            ))}
          </Select>
        </div>

        {canCreateRequest && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={selectAllNeeded}>
              Tout selectionner
            </Button>
            <Button onClick={createRequest} disabled={selected.size === 0}>
              <ClipboardPlus />
              Creer une demande ({selected.size})
            </Button>
          </div>
        )}
      </div>

      <DataTableShell
        isLoading={query.isLoading && items.length === 0}
        isFetching={query.isFetching}
        error={query.error === null ? undefined : "Le chargement des alertes a echoue."}
        isEmpty={items.length === 0}
        caption={`${formatQuantity(shownCount)} article${shownCount > 1 ? "s" : ""} — tries par severite puis par couverture restante`}
        empty={{
          icon: ShieldCheck,
          title: isFiltered ? "Aucune alerte pour ce filtre" : "Aucune alerte",
          description: isFiltered
            ? "Elargissez la severite ou la classe pour voir davantage d articles."
            : "Tous les articles suivis sont au-dessus de leur seuil de declenchement. Rien a reapprovisionner.",
        }}
      >
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                {canCreateRequest && <TableHead className="w-10" aria-label="Selection" />}
                <TableHead>Alerte</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead>Site</TableHead>
                <TableNumericHead>Stock</TableNumericHead>
                <TableNumericHead>Seuil mini</TableNumericHead>
                <TableNumericHead>Seuil maxi</TableNumericHead>
                <TableNumericHead>Couverture</TableNumericHead>
                <TableNumericHead>Qte preconisee</TableNumericHead>
              </TableRow>
            </TableHeader>

            <AlertRows
              items={items}
              selected={selected}
              onToggle={toggle}
              selectable={canCreateRequest}
            />
          </Table>
        </TableContainer>
      </DataTableShell>
    </div>
  );
}
