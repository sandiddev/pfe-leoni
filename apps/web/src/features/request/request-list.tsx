"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  PRIORITY_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  type RequestListItem,
} from "@leoni/contracts";
import { REQUEST_PRIORITIES, REQUEST_STATUSES, type RequestPriority, type RequestStatus } from "@leoni/core";
import {
  Badge,
  Button,
  DataTableShell,
  formatDate,
  formatQuantity,
  Input,
  Pagination,
  RequestStatusBadge,
  Select,
  Table,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableNumericCell,
  TableNumericHead,
  TableRow,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface RequestListProps {
  /** Fetched on the server so the first paint has rows, not a spinner. */
  readonly initialItems: readonly RequestListItem[];
  readonly totalCount: number;
}

const PAGE_SIZE = 25;

/**
 * The request list, with the derived late indicator.
 *
 * "En retard" is a badge beside the status, never instead of it: a request can
 * be late while it is still in preparation, and replacing the status would lose
 * the only information that says what to do about it.
 */
export function RequestList({ initialItems, totalCount }: RequestListProps) {
  const trpc = useTRPC();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<RequestStatus | "ALL">("ALL");
  const [priority, setPriority] = useState<RequestPriority | "ALL">("ALL");
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyLate, setOnlyLate] = useState(false);
  const [cursors, setCursors] = useState<readonly string[]>([]);

  const cursor = cursors.at(-1) ?? null;
  const isFiltered =
    search !== "" || status !== "ALL" || priority !== "ALL" || onlyMine || onlyLate;

  const query = useQuery(
    trpc.request.list.queryOptions({
      limit: PAGE_SIZE,
      cursor,
      onlyMine,
      onlyLate,
      ...(search === "" ? {} : { search }),
      ...(status === "ALL" ? {} : { status }),
      ...(priority === "ALL" ? {} : { priority }),
    }),
  );

  const items = query.data?.items ?? (isFiltered || cursor !== null ? [] : initialItems);
  const shownCount = query.data?.totalCount ?? totalCount;

  const changeFilter = (apply: () => void) => {
    setCursors([]);
    apply();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            className="pl-8"
            placeholder="Code de demande ou reference d article"
            aria-label="Rechercher une demande"
            value={search}
            onChange={(event) => {
              const next = event.target.value;
              changeFilter(() => {
                setSearch(next);
              });
            }}
          />
        </div>

        <Select
          className="w-56"
          aria-label="Filtrer par statut"
          value={status}
          onChange={(event) => {
            const next = REQUEST_STATUSES.find((candidate) => candidate === event.target.value);
            changeFilter(() => {
              setStatus(next ?? "ALL");
            });
          }}
        >
          <option value="ALL">Tous les statuts</option>
          {REQUEST_STATUSES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {REQUEST_STATUS_LABELS_FR[candidate]}
            </option>
          ))}
        </Select>

        <Select
          className="w-44"
          aria-label="Filtrer par priorite"
          value={priority}
          onChange={(event) => {
            const next = REQUEST_PRIORITIES.find((candidate) => candidate === event.target.value);
            changeFilter(() => {
              setPriority(next ?? "ALL");
            });
          }}
        >
          <option value="ALL">Toutes priorites</option>
          {REQUEST_PRIORITIES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {PRIORITY_LABELS_FR[candidate]}
            </option>
          ))}
        </Select>

        <Button
          size="sm"
          variant={onlyMine ? "primary" : "outline"}
          aria-pressed={onlyMine}
          onClick={() => {
            changeFilter(() => {
              setOnlyMine(!onlyMine);
            });
          }}
        >
          Mes demandes
        </Button>

        <Button
          size="sm"
          variant={onlyLate ? "primary" : "outline"}
          aria-pressed={onlyLate}
          onClick={() => {
            changeFilter(() => {
              setOnlyLate(!onlyLate);
            });
          }}
        >
          En retard
        </Button>
      </div>

      <DataTableShell
        isLoading={query.isLoading && items.length === 0}
        isFetching={query.isFetching}
        error={query.error === null ? undefined : "Le chargement des demandes a echoue."}
        isEmpty={items.length === 0}
        caption={`${formatQuantity(shownCount)} demande${shownCount > 1 ? "s" : ""}`}
        empty={{
          icon: ClipboardList,
          title: isFiltered ? "Aucune demande ne correspond aux filtres" : "Aucune demande",
          description: isFiltered
            ? "Changez le statut, la priorite ou desactivez les filtres pour voir davantage de demandes."
            : "Partez du tableau des alertes pour creer la premiere demande.",
        }}
      >
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Priorite</TableHead>
                <TableNumericHead>Lignes</TableNumericHead>
                <TableNumericHead>Qte demandee</TableNumericHead>
                <TableHead>Livraison prevue</TableHead>
                <TableHead>Demandeur</TableHead>
                <TableHead>Creee le</TableHead>
              </TableRow>
            </TableHeader>

            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <Link href={`/demandes/${item.id}`} className="text-primary hover:underline">
                      {item.code}
                    </Link>
                  </TableCell>
                  <TableCell className="space-x-1.5 whitespace-nowrap">
                    <RequestStatusBadge status={item.status} />
                    {item.isLate && (
                      <Badge
                        variant="stopped"
                        title={`${formatQuantity(item.daysLate)} jour(s) de retard`}
                      >
                        En retard
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{PRIORITY_LABELS_FR[item.priority]}</Badge>
                  </TableCell>
                  <TableNumericCell>{formatQuantity(item.lineCount)}</TableNumericCell>
                  <TableNumericCell>{formatQuantity(item.totalRequested)}</TableNumericCell>
                  <TableCell className="whitespace-nowrap text-foreground-muted">
                    {formatDate(item.expectedDeliveryAt)}
                  </TableCell>
                  <TableCell className="text-foreground-muted">{item.createdByName}</TableCell>
                  <TableCell className="whitespace-nowrap text-foreground-muted">
                    {formatDate(item.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
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
    </div>
  );
}
