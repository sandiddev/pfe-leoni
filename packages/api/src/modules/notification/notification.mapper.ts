import type { NotificationItem } from "@leoni/contracts";

import type { NotificationRow } from "./notification.repository";

/**
 * Rows to the DTOs the notification centre renders.
 *
 * The payload is JSON because the types carry genuinely different data — a
 * critical-stock alert names an article, a rejection names a request. The one
 * field every screen wants out of it is the request identifier, so the link
 * works; the rest stays opaque rather than being flattened into columns that
 * would be null for most types.
 */

/**
 * Reads `requestId` out of an untyped payload.
 *
 * `unknown` narrowed with a guard, not a cast: the column is `Json`, so nothing
 * guarantees its shape, and asserting one would turn a malformed row into a
 * runtime error on a screen rather than a missing link.
 */
function requestIdFrom(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("requestId" in payload)) return null;

  const value: unknown = payload.requestId;
  return typeof value === "string" ? value : null;
}

export function toNotificationItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    requestId: requestIdFrom(row.payload),
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}
