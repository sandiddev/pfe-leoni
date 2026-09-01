"use client";

import { useQuery } from "@tanstack/react-query";
import { ScrollText, X } from "lucide-react";
import { useState } from "react";

import type { AuditEntryItem } from "@leoni/contracts";
import {
  Badge,
  Button,
  DataTableShell,
  formatDateTime,
  formatQuantity,
  Input,
  Pagination,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface AuditLogProps {
  /** Fetched on the server so the first paint has rows, not a spinner. */
  readonly initialItems: readonly AuditEntryItem[];
  readonly totalCount: number;
}

const PAGE_SIZE = 25;

/**
 * The audit log.
 *
 * Renders the field-level diff the server computed rather than the raw JSON:
 * the point of the log is that somebody can read what changed months later, and
 * a payload on screen is a log nobody consults.
 */
export function AuditLog({ initialItems, totalCount }: AuditLogProps) {
  const trpc = useTRPC();

  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursors, setCursors] = useState<readonly string[]>([]);

  const cursor = cursors.at(-1) ?? null;
  const entities = useQuery(trpc.admin.audit.entities.queryOptions({}));

  const isFiltered = entity !== "" || from !== "" || to !== "";

  const query = useQuery(
    trpc.admin.audit.list.queryOptions({
      limit: PAGE_SIZE,
      cursor,
      ...(entity === "" ? {} : { entity }),
      ...(from === "" ? {} : { from: new Date(from) }),
      // Inclusive of the whole closing day, like the stock journal's range.
      ...(to === "" ? {} : { to: new Date(`${to}T23:59:59.999`) }),
    }),
  );

  const items = query.data?.items ?? (!isFiltered && cursor === null ? initialItems : []);
  const shownCount = query.data?.totalCount ?? totalCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-56"
          aria-label="Filtrer par entite"
          value={entity}
          onChange={(event) => {
            setCursors([]);
            setEntity(event.target.value);
          }}
        >
          <option value="">Toutes les entites</option>
          {(entities.data ?? []).map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </Select>

        <Input
          type="date"
          className="w-40"
          aria-label="Depuis"
          value={from}
          onChange={(event) => {
            setCursors([]);
            setFrom(event.target.value);
          }}
        />
        <span className="text-sm text-foreground-muted">au</span>
        <Input
          type="date"
          className="w-40"
          aria-label="Jusqu au"
          value={to}
          onChange={(event) => {
            setCursors([]);
            setTo(event.target.value);
          }}
        />

        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCursors([]);
              setEntity("");
              setFrom("");
              setTo("");
            }}
          >
            <X />
            Effacer
          </Button>
        )}
      </div>

      <DataTableShell
        isLoading={query.isLoading && items.length === 0}
        isFetching={query.isFetching}
        error={query.error === null ? undefined : "Le chargement du journal a echoue."}
        isEmpty={items.length === 0}
        caption={`${formatQuantity(shownCount)} entree${shownCount > 1 ? "s" : ""}`}
        empty={{
          icon: ScrollText,
          title: isFiltered ? "Aucune entree sur cette periode" : "Aucune entree",
          description: isFiltered
            ? "Elargissez la periode ou changez d entite."
            : "Le journal se remplit des la premiere modification de donnees de reference ou de parametres.",
        }}
      >
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entite</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Auteur</TableHead>
                <TableHead>Modifications</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-foreground-muted">
                    {formatDateTime(entry.occurredAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{entry.entity}</span>
                    <span className="block text-xs text-foreground-subtle">{entry.entityId}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{entry.action}</Badge>
                  </TableCell>
                  <TableCell className="text-foreground-muted">
                    {entry.actorName ?? "Systeme"}
                  </TableCell>
                  <TableCell>
                    {entry.changes.length === 0 ? (
                      <span className="text-foreground-subtle">—</span>
                    ) : (
                      <ul className="space-y-0.5 text-sm">
                        {entry.changes.map((change) => (
                          <li key={change.field}>
                            <span className="text-foreground-muted">{change.field} : </span>
                            <span className="text-status-rupture line-through">
                              {change.before ?? "—"}
                            </span>
                            {" -> "}
                            <span className="text-status-normal">{change.after ?? "—"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
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
