"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { NOTIFICATION_TYPE_LABELS_FR, type NotificationItem } from "@leoni/contracts";
import type { NotificationType } from "@leoni/core";
import { Badge, Button, DataTableShell, formatDateTime, formatQuantity } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

export interface NotificationCentreProps {
  /** Fetched on the server so the first paint has rows, not a spinner. */
  readonly initialItems: readonly NotificationItem[];
  readonly totalCount: number;
}

/** Bad news reads as bad news, whatever the wording. */
const TONE: Partial<Record<NotificationType, "rupture" | "warning" | "normal">> = {
  STOCK_RUPTURE: "rupture",
  LTN4_STOCK_OUT: "rupture",
  REQUEST_REJECTED: "rupture",
  STOCK_CRITICAL: "warning",
  REQUEST_LATE: "warning",
  REQUEST_RECEIVED: "normal",
};

export function NotificationCentre({ initialItems, totalCount }: NotificationCentreProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [onlyUnread, setOnlyUnread] = useState(false);

  const query = useQuery(
    trpc.notification.list.queryOptions({ limit: 50, onlyUnread }),
  );

  const refresh = () => {
    void queryClient.invalidateQueries();
  };

  const markRead = useMutation(trpc.notification.markRead.mutationOptions({ onSuccess: refresh }));
  const markAllRead = useMutation(
    trpc.notification.markAllRead.mutationOptions({ onSuccess: refresh }),
  );

  const items = query.data?.items ?? (onlyUnread ? [] : initialItems);
  const shownCount = query.data?.totalCount ?? totalCount;
  const unread = items.filter((item) => item.readAt === null).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant={onlyUnread ? "primary" : "outline"}
          aria-pressed={onlyUnread}
          onClick={() => {
            setOnlyUnread(!onlyUnread);
          }}
        >
          Non lues
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={markAllRead.isPending || unread === 0}
          onClick={() => {
            markAllRead.mutate({});
          }}
        >
          <CheckCheck />
          Tout marquer comme lu
        </Button>
      </div>

      <DataTableShell
        isLoading={query.isLoading && items.length === 0}
        isFetching={query.isFetching}
        error={query.error === null ? undefined : "Le chargement des notifications a echoue."}
        isEmpty={items.length === 0}
        caption={`${formatQuantity(shownCount)} notification${shownCount > 1 ? "s" : ""}`}
        empty={{
          icon: BellOff,
          title: onlyUnread ? "Aucune notification non lue" : "Aucune notification",
          description: onlyUnread
            ? "Tout est lu. Desactivez le filtre pour revoir l historique."
            : "Les evenements du workflow apparaitront ici des la premiere demande.",
        }}
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <li
              key={item.id}
              className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                item.readAt === null ? "bg-surface" : "bg-surface-sunken"
              }`}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={TONE[item.type] ?? "primary"}>
                    {NOTIFICATION_TYPE_LABELS_FR[item.type]}
                  </Badge>
                  <span className="text-sm font-medium">{item.title}</span>
                  {item.readAt === null && (
                    <span
                      className="size-2 rounded-full bg-primary"
                      aria-label="Non lue"
                      role="img"
                    />
                  )}
                </div>
                {item.body !== null && (
                  <p className="text-sm text-foreground-muted">{item.body}</p>
                )}
                <p className="text-xs text-foreground-subtle">{formatDateTime(item.createdAt)}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {item.requestId !== null && (
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/demandes/${item.requestId}`}>Ouvrir la demande</Link>
                  </Button>
                )}
                {item.readAt === null && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={markRead.isPending}
                    onClick={() => {
                      markRead.mutate({ notificationId: item.id });
                    }}
                  >
                    Marquer comme lu
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </DataTableShell>
    </div>
  );
}
