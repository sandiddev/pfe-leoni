"use client";

import { useQuery } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";
import { useState } from "react";

import type { ArticleListItem } from "@leoni/contracts";
import type { AlertLevel } from "@leoni/core";
import {
  Button,
  EmptyState,
  formatQuantity,
  Table,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericHead,
  TableRow,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

import { ArticleFilters } from "./article-filters";
import { ArticleRows } from "./article-rows";

export interface ArticleTableProps {
  /** Fetched on the server so the first paint has rows, not a spinner. */
  readonly initialItems: readonly ArticleListItem[];
  readonly totalCount: number;
}

/** The article list: owns the filter state, delegates the markup. */
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

  const resetFilters = () => {
    setSearch("");
    setAlertLevel("ALL");
    setOnlyReplenishable(false);
  };

  return (
    <div className="space-y-4">
      <ArticleFilters
        search={search}
        onSearchChange={setSearch}
        alertLevel={alertLevel}
        onAlertLevelChange={setAlertLevel}
        onlyReplenishable={onlyReplenishable}
        onOnlyReplenishableChange={setOnlyReplenishable}
      />

      <p className="text-sm text-foreground-muted" aria-live="polite">
        {formatQuantity(shownCount)} article{shownCount > 1 ? "s" : ""}
        {query.isFetching && " — actualisation..."}
      </p>

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
              <Button variant="outline" size="sm" onClick={resetFilters}>
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

            <ArticleRows items={items} />
          </Table>
        </TableContainer>
      )}
    </div>
  );
}
