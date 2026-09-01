"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";

import { Button } from "@leoni/ui";
import { useTRPC } from "~/trpc/client";

/** A minute is soon enough for a store, and cheap enough for a count query. */
const REFRESH_INTERVAL_MS = 60_000;

/**
 * The unread count in the top bar.
 *
 * Polls rather than pushes. A WebSocket would be the right answer for a busier
 * application; here the events are a handful a day, and a one-minute poll of a
 * counted index costs less than the connection it would replace.
 */
export function NotificationBell() {
  const trpc = useTRPC();

  const query = useQuery({
    ...trpc.notification.unreadCount.queryOptions({}),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const count = query.data?.count ?? 0;

  return (
    <Button asChild variant="ghost" size="icon" aria-label={`Notifications (${String(count)} non lues)`}>
      <Link href="/notifications" className="relative">
        <Bell />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-4 font-semibold text-foreground-on-primary">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
}
