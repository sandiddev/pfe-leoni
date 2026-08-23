"use client";

import { useQuery } from "@tanstack/react-query";
import { PackageSearch, Search } from "lucide-react";
import { useState } from "react";

import { ALERT_LEVEL_LABELS_FR, type ArticleListItem } from "@leoni/contracts";
import type { AlertLevel } from "@leoni/core";
import {
  AlertLevelBadge,
  Badge,
  Button,
  EmptyState,
  formatCoverage,
  formatQuantity,
  Input,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericCell,
  TableNumericHead,
  TableRow,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface ArticleTableProps {
  /** Fetched on the server so the first paint has rows, not a spinner. */
  readonly initialItems: readonly ArticleListItem[];
  readonly totalCount: number;
}

const ALERT_FILTERS: readonly (AlertLevel | "ALL")[] = [
  "ALL",
  "RUPTURE",
  "CRITICAL",
  "WARNING",
  "NORMAL",
];

/**
 * The article list.
 *
 * Every computed column here — the alert level, the coverage in days, the
 * suggested quantity — is rendered from what the server sent. None of it is
 * recalculated in the browser: the formulas live in `@leoni/core` and are unit
 * tested there, and a second implementation in a component would be a second
 * set of numbers for the same article.
 */
export function ArticleTable({ initialItems, totalCount }: ArticleTableProps) {
  const trpc = useTRPC();

  const [search, setSearch] = useState("");
  const [alertLevel, setAlertLevel] = useState<AlertLevel | "ALL">("ALL");
  const [onlyReplenishable, setOnlyReplenishable] = useState(false);

  const isFiltered = search !== "" || alertLevel !== "ALL" || onlyReplenishable;

  const query = useQuery(
    trpc.article.list.queryOptions({
      limit: 25,
      includeInactive: false,
      onlyReplenishable,
      sortBy: "reference",
      sortDirection: "asc",
      ...(search === "" ? {} : { search }),
      ...(alertLevel === "ALL" ? {} : { alertLevel }),
    }),
  );

  // While a filtered query is loading, the previously rendered rows stay on
  // screen rather than collapsing to an empty table and back.
  const items = query.data?.items ?? (isFiltered ? [] : initialItems);
  const shownCount = query.data?.totalCount ?? totalCount;

  return (
    <div className="space-y-4">
      {/* --- Filters --- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            className="pl-8"
            placeholder="Rechercher une reference ou une designation"
            aria-label="Rechercher un article"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>

        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Filtrer par niveau d alerte"
        >
          {ALERT_FILTERS.map((level) => (
            <Button
              key={level}
              size="sm"
              variant={alertLevel === level ? "primary" : "outline"}
              aria-pressed={alertLevel === level}
              onClick={() => {
                setAlertLevel(level);
              }}
            >
              {level === "ALL" ? "Tous" : ALERT_LEVEL_LABELS_FR[level]}
            </Button>
          ))}
        </div>

        <Button
          size="sm"
          variant={onlyReplenishable ? "primary" : "outline"}
          aria-pressed={onlyReplenishable}
          onClick={() => {
            setOnlyReplenishable((value) => !value);
          }}
        >
          A reapprovisionner
        </Button>
      </div>

      <p className="text-sm text-foreground-muted" aria-live="polite">
        {formatQuantity(shownCount)} article{shownCount > 1 ? "s" : ""}
        {query.isFetching && " — actualisation..."}
      </p>

      {/* --- Table --- */}
      {items.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={isFiltered ? "Aucun article ne correspond aux filtres" : "Aucun article"}
          description={
            isFiltered
              ? "Elargissez la recherche ou reinitialisez les filtres pour voir davantage de references."
              : "Importez le fichier articles pour alimenter le catalogue."
          }
          action={
            isFiltered ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setAlertLevel("ALL");
                  setOnlyReplenishable(false);
                }}
              >
                Reinitialiser les filtres
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead>Alerte</TableHead>
                <TableNumericHead>Stock</TableNumericHead>
                <TableNumericHead>Seuil mini</TableNumericHead>
                <TableNumericHead>Seuil maxi</TableNumericHead>
                <TableNumericHead>Couverture</TableNumericHead>
                <TableNumericHead>Qte preconisee</TableNumericHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {items.map((item) => (
                <TableRow key={item.stockItemId}>
                  <TableCell className="font-medium whitespace-nowrap">{item.reference}</TableCell>
                  <TableCell className="max-w-64 truncate" title={item.designation}>
                    {item.designation}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.abcClass}</Badge>
                  </TableCell>
                  <TableCell>
                    <AlertLevelBadge level={item.alertLevel} />
                  </TableCell>
                  <TableNumericCell>{formatQuantity(item.currentStock)}</TableNumericCell>
                  <TableNumericCell className="text-foreground-muted">
                    {formatQuantity(item.minThreshold)}
                  </TableNumericCell>
                  <TableNumericCell className="text-foreground-muted">
                    {formatQuantity(item.maxThreshold)}
                  </TableNumericCell>
                  <TableNumericCell
                    className={
                      item.willRunOutBeforeResupply ? "font-medium text-status-critical" : undefined
                    }
                    title={
                      item.willRunOutBeforeResupply
                        ? "La couverture est inferieure au delai de livraison de LTN4"
                        : undefined
                    }
                  >
                    {formatCoverage(item.coverageDays)}
                  </TableNumericCell>
                  <TableNumericCell>
                    {item.isReplenishmentNeeded ? (
                      <span
                        className="font-medium"
                        title={`Besoin ${formatQuantity(item.need)} — ${formatQuantity(item.boxCount)} boite(s) de ${formatQuantity(item.vpe)}`}
                      >
                        {formatQuantity(item.recommendedQuantity)}
                      </span>
                    ) : (
                      <span className="text-foreground-subtle">—</span>
                    )}
                  </TableNumericCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}
