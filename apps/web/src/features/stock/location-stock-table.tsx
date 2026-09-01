"use client";

import { useQuery } from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import { useState } from "react";

import type { StorageLocationOption } from "@leoni/contracts";
import {
  DataTableShell,
  formatDate,
  formatQuantity,
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
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface LocationStockTableProps {
  readonly locations: readonly StorageLocationOption[];
}

/**
 * What each shelf is holding, in FIFO order.
 *
 * `stock.byLocation` has existed since the stock module was written and had no
 * screen. It answers the question a picker actually has — "where do I go, and
 * which lot do I take" — which the chronological journal cannot.
 */
export function LocationStockTable({ locations }: LocationStockTableProps) {
  const trpc = useTRPC();
  const [locationId, setLocationId] = useState("");

  const query = useQuery(
    trpc.stock.byLocation.queryOptions(
      locationId === "" ? {} : { storageLocationId: locationId },
    ),
  );

  const items = query.data ?? [];
  const total = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <DataTableShell
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      error={query.error === null ? undefined : "Le chargement du stock par emplacement a echoue."}
      isEmpty={items.length === 0}
      caption={`${formatQuantity(items.length)} lot(s), ${formatQuantity(total)} unites`}
      toolbar={
        <Select
          className="w-56"
          aria-label="Filtrer par emplacement"
          value={locationId}
          onChange={(event) => {
            setLocationId(event.target.value);
          }}
        >
          <option value="">Tous les emplacements</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.code}
              {location.description === null ? "" : ` — ${location.description}`}
            </option>
          ))}
        </Select>
      }
      empty={{
        icon: Boxes,
        title: "Aucun lot en stock",
        description: "Rien n est pose sur cet emplacement pour le moment.",
      }}
    >
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Emplacement</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Date d entree (FIFO)</TableHead>
              <TableNumericHead>Quantite</TableNumericHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {items.map((item) => (
              <TableRow key={item.lotId}>
                <TableCell className="font-medium">{item.locationCode}</TableCell>
                <TableCell className="whitespace-nowrap">{item.articleReference}</TableCell>
                <TableCell className="max-w-56 truncate">{item.articleDesignation}</TableCell>
                <TableCell className="text-foreground-muted">{formatDate(item.fifoDate)}</TableCell>
                <TableNumericCell>{formatQuantity(item.quantity)}</TableNumericCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </DataTableShell>
  );
}
