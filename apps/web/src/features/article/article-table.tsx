"use client";

import { useQuery } from "@tanstack/react-query";
import { PackageSearch, Plus } from "lucide-react";
import { useState } from "react";

import type { ArticleListItem } from "@leoni/contracts";
import type { AbcClass, AlertLevel } from "@leoni/core";
import {
  Button,
  DataTableShell,
  formatQuantity,
  Pagination,
  SortableTableHead,
  type SortDirection,
  Table,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

import { ArticleFilters } from "./article-filters";
import { ArticleFormDialog } from "./article-form-dialog";
import { ArticleRows } from "./article-rows";

export interface ArticleTableProps {
  /** Fetched on the server so the first paint has rows, not a spinner. */
  readonly initialItems: readonly ArticleListItem[];
  readonly totalCount: number;
  readonly canWrite: boolean;
}

/** The fields the API can sort on. Anything else would be a silent no-op. */
type SortField = "reference" | "designation" | "currentStock" | "coverageDays" | "alertLevel";

const PAGE_SIZE = 25;

/** The article list: owns the filter and sort state, delegates the markup. */
export function ArticleTable({ initialItems, totalCount, canWrite }: ArticleTableProps) {
  const trpc = useTRPC();

  const [search, setSearch] = useState("");
  const [alertLevel, setAlertLevel] = useState<AlertLevel | "ALL">("ALL");
  const [abcClass, setAbcClass] = useState<AbcClass | "ALL">("ALL");
  const [onlyReplenishable, setOnlyReplenishable] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>("reference");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [cursors, setCursors] = useState<readonly string[]>([]);
  const [editing, setEditing] = useState<ArticleListItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const cursor = cursors.at(-1) ?? null;

  const isFiltered =
    search !== "" ||
    alertLevel !== "ALL" ||
    abcClass !== "ALL" ||
    onlyReplenishable ||
    includeInactive;

  const query = useQuery(
    trpc.article.list.queryOptions({
      limit: PAGE_SIZE,
      cursor,
      includeInactive,
      onlyReplenishable,
      sortBy,
      sortDirection,
      ...(search === "" ? {} : { search }),
      ...(alertLevel === "ALL" ? {} : { alertLevel }),
      ...(abcClass === "ALL" ? {} : { abcClass }),
    }),
  );

  // While a filtered query is loading, the previously rendered rows stay on
  // screen rather than collapsing to an empty table and back.
  const isDefaultView = !isFiltered && cursor === null && sortBy === "reference";
  const items = query.data?.items ?? (isDefaultView ? initialItems : []);
  const shownCount = query.data?.totalCount ?? totalCount;

  /** Any filter or sort change invalidates the cursor stack it was built on. */
  const rewind = (apply: () => void) => {
    setCursors([]);
    apply();
  };

  const resetFilters = () => {
    rewind(() => {
      setSearch("");
      setAlertLevel("ALL");
      setAbcClass("ALL");
      setOnlyReplenishable(false);
      setIncludeInactive(false);
    });
  };

  const sortProps = (field: SortField) => ({
    field,
    activeField: sortBy,
    direction: sortDirection,
    onSort: (next: SortField, direction: SortDirection) => {
      rewind(() => {
        setSortBy(next);
        setSortDirection(direction);
      });
    },
  });

  return (
    <div className="space-y-4">
      <DataTableShell
        isLoading={query.isLoading && items.length === 0}
        isFetching={query.isFetching}
        error={query.error === null ? undefined : "Le chargement des articles a echoue."}
        isEmpty={items.length === 0}
        caption={`${formatQuantity(shownCount)} article${shownCount > 1 ? "s" : ""}`}
        toolbar={
          <div className="flex flex-wrap items-start justify-between gap-2">
            <ArticleFilters
              search={search}
              onSearchChange={(value) => {
                rewind(() => {
                  setSearch(value);
                });
              }}
              alertLevel={alertLevel}
              onAlertLevelChange={(value) => {
                rewind(() => {
                  setAlertLevel(value);
                });
              }}
              abcClass={abcClass}
              onAbcClassChange={(value) => {
                rewind(() => {
                  setAbcClass(value);
                });
              }}
              onlyReplenishable={onlyReplenishable}
              onOnlyReplenishableChange={(value) => {
                rewind(() => {
                  setOnlyReplenishable(value);
                });
              }}
              includeInactive={includeInactive}
              onIncludeInactiveChange={(value) => {
                rewind(() => {
                  setIncludeInactive(value);
                });
              }}
            />

            {canWrite && (
              <Button
                onClick={() => {
                  setIsCreating(true);
                }}
              >
                <Plus />
                Nouvel article
              </Button>
            )}
          </div>
        }
        empty={{
          icon: PackageSearch,
          title: isFiltered ? "Aucun article ne correspond aux filtres" : "Aucun article",
          description: isFiltered
            ? "Elargissez la recherche ou reinitialisez les filtres pour voir davantage de references."
            : "Creez une premiere reference pour alimenter le catalogue.",
          ...(isFiltered
            ? {
                action: (
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    Reinitialiser les filtres
                  </Button>
                ),
              }
            : {}),
        }}
      >
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead {...sortProps("reference")}>Reference</SortableTableHead>
                <SortableTableHead {...sortProps("designation")}>Designation</SortableTableHead>
                <TableHead>Classe</TableHead>
                <SortableTableHead {...sortProps("alertLevel")}>Alerte</SortableTableHead>
                <SortableTableHead {...sortProps("currentStock")} numeric>
                  Stock
                </SortableTableHead>
                <TableHead className="text-right">Seuil mini</TableHead>
                <TableHead className="text-right">Seuil maxi</TableHead>
                <SortableTableHead {...sortProps("coverageDays")} numeric>
                  Couverture
                </SortableTableHead>
                <TableHead className="text-right">Qte preconisee</TableHead>
                {canWrite && <TableHead className="w-12 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>

            <ArticleRows items={items} canWrite={canWrite} onEdit={setEditing} />
          </Table>
        </TableContainer>
      </DataTableShell>

      <Pagination
        page={cursors.length + 1}
        totalCount={shownCount}
        hasPrevious={cursors.length > 0}
        hasNext={(query.data?.nextCursor ?? null) !== null}
        onPrevious={() => {
          setCursors((previous) => previous.slice(0, -1));
        }}
        onNext={() => {
          const next = query.data?.nextCursor ?? null;
          if (next !== null) setCursors((previous) => [...previous, next]);
        }}
      />

      {(isCreating || editing !== null) && (
        <ArticleFormDialog
          open
          {...(editing === null ? {} : { article: editing })}
          onClose={() => {
            setIsCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            void query.refetch();
          }}
        />
      )}
    </div>
  );
}
