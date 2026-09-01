import type {
  MarkNotificationReadInput,
  NotificationItem,
  NotificationListInput,
  Page,
} from "@leoni/contracts";

import type { Actor } from "../../context";
import * as mapper from "./notification.mapper";
import type { NotificationRepository } from "./notification.repository";
import { notificationRepository } from "./notification.repository";

/**
 * Business rules for the notification centre.
 *
 * Short, because the scoping rule is the whole of it: a notification belongs to
 * one user, and every operation below is bounded by `actor.userId` rather than
 * by anything the client sends. There is no site check to make — the row was
 * addressed to a person, not to a plant.
 */

interface ServiceParams<TInput> {
  readonly actor: Actor;
  readonly input: TInput;
  /** Injected by the tests. Defaults to the Prisma-backed repository. */
  readonly repository?: NotificationRepository;
}

export async function list({
  actor,
  input,
  repository = notificationRepository,
}: ServiceParams<NotificationListInput>): Promise<Page<NotificationItem>> {
  const { rows, totalCount } = await repository.findMany(actor.userId, input);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  return {
    items: page.map(mapper.toNotificationItem),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    totalCount,
  };
}

export async function unreadCount({
  actor,
  repository = notificationRepository,
}: {
  readonly actor: Actor;
  readonly repository?: NotificationRepository;
}): Promise<{ count: number }> {
  return { count: await repository.countUnread(actor.userId) };
}

export async function markRead({
  actor,
  input,
  repository = notificationRepository,
}: ServiceParams<MarkNotificationReadInput>): Promise<void> {
  // No "not found" case on purpose: an identifier belonging to somebody else
  // matches nothing, and saying so would confirm that the notification exists.
  await repository.markRead(actor.userId, input.notificationId, new Date());
}

export async function markAllRead({
  actor,
  repository = notificationRepository,
}: {
  readonly actor: Actor;
  readonly repository?: NotificationRepository;
}): Promise<{ count: number }> {
  return { count: await repository.markAllRead(actor.userId, new Date()) };
}
