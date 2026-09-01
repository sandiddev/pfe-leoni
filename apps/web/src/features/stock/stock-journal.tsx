"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Scale } from "lucide-react";
import { useState } from "react";

import type { StockMovementListItem, StorageLocationOption } from "@leoni/contracts";
import {
  Button,
  DataTableShell,
  formatQuantity,
  Pagination,
  Table,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericHead,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

import { LocationStockTable } from "./location-stock-table";
import { MovementDialog } from "./movement-dialog";
import {
  EMPTY_STOCK_FILTERS,
  isStockFiltered,
  StockFilters,
  type StockFilterState,
} from "./stock-filters";
import { StockRows } from "./stock-rows";

export interface StockJournalProps {
  /** Fetched on the server so the first paint has rows, not a spinner. */
  readonly initialItems: readonly StockMovementListItem[];
  readonly totalCount: number;
  readonly locations: readonly StorageLocationOption[];
  readonly canMove: boolean;
  readonly canAdjust: boolean;
}

const PAGE_SIZE = 25;

/**
 * The movement journal: owns the filters, the cursor stack and the form.
 *
 * The cursors are kept as a stack rather than a page number because the API
 * paginates by cursor — going back means popping the one that got you here,
 * which is exactly what an offset cannot express over a table that is being
 * written to while it is read.
 */
export function StockJournal({
  initialItems,
  totalCount,
  locations,
  canMove,
  canAdjust,
}: StockJournalProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<StockFilterState>(EMPTY_STOCK_FILTERS);
  const [cursors, setCursors] = useState<readonly string[]>([]);
  const [dialog, setDialog] = useState<"move" | "adjust" | null>(null);

  const cursor = cursors.at(-1) ?? null;
  const isFiltered = isStockFiltered(filters);

  const query = useQuery(
    trpc.stock.list.queryOptions({
      limit: PAGE_SIZE,
      cursor,
      ...(filters.search === "" ? {} : { search: filters.search }),
      ...(filters.type === "ALL" ? {} : { type: filters.type }),
      ...(filters.storageLocationId === ""
        ? {}
        : { storageLocationId: filters.storageLocationId }),
      ...(filters.from === "" ? {} : { from: new Date(filters.from) }),
      // The upper bound is inclusive of the whole day: a range ending "today"
      // that excluded today's movements would be read as a bug, correctly.
      ...(filters.to === "" ? {} : { to: new Date(`${filters.to}T23:59:59.999`) }),
    }),
  );

  // While a filtered query is loading, the rows already on screen stay put
  // rather than collapsing to an empty table and back.
  const items = query.data?.items ?? (isFiltered || cursor !== null ? [] : initialItems);
  const shownCount = query.data?.totalCount ?? totalCount;

  const refresh = () => {
    setCursors([]);
    void queryClient.invalidateQueries();
  };

  return (
    <Tabs defaultValue="journal">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="journal">Journal des mouvements</TabsTrigger>
          <TabsTrigger value="emplacements">Par emplacement</TabsTrigger>
        </TabsList>

        <div className="flex gap-2">
          {canAdjust && (
            <Button
              variant="outline"
              onClick={() => {
                setDialog("adjust");
              }}
            >
              <Scale />
              Inventaire
            </Button>
          )}
          {canMove && (
            <Button
              onClick={() => {
                setDialog("move");
              }}
            >
              <Plus />
              Saisir un mouvement
            </Button>
          )}
        </div>
      </div>

      <TabsContent value="journal">
      <DataTableShell
        isLoading={query.isLoading && items.length === 0}
        isFetching={query.isFetching}
        error={query.error === null ? undefined : "Le chargement du journal a echoue."}
        isEmpty={items.length === 0}
        caption={`${formatQuantity(shownCount)} mouvement${shownCount > 1 ? "s" : ""}`}
        toolbar={
          <StockFilters
            value={filters}
            locations={locations}
            onChange={(next) => {
              // Any filter change invalidates the cursor stack it was built on.
              setCursors([]);
              setFilters(next);
            }}
          />
        }
        empty={{
          icon: ClipboardList,
          title: isFiltered ? "Aucun mouvement ne correspond aux filtres" : "Aucun mouvement",
          description: isFiltered
            ? "Elargissez la recherche, la periode ou le type de mouvement."
            : "Le journal se remplit des la premiere entree ou sortie saisie.",
        }}
      >
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Designation</TableHead>
                <TableNumericHead>Quantite</TableNumericHead>
                <TableHead>Emplacement</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Saisi par</TableHead>
              </TableRow>
            </TableHeader>

            <StockRows items={items} />
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
      </TabsContent>

      <TabsContent value="emplacements">
        <LocationStockTable locations={locations} />
      </TabsContent>

      {dialog !== null && (
        <MovementDialog
          open
          mode={dialog}
          locations={locations}
          onClose={() => {
            setDialog(null);
          }}
          onRecorded={refresh}
        />
      )}
    </Tabs>
  );
}
