import type { NotificationListInput } from "@leoni/contracts";
import type { Prisma } from "@leoni/db";
import { db } from "@leoni/db";

/**
 * Persistence for the notification centre.
 *
 * Reads and read-marks only. Notifications are *written* by the module whose
 * change caused them, inside that change's transaction — see
 * `request.repository.ts#applyTransition`. Giving this module a create method
 * would invite a second path that fires outside the transaction, which is how a
 * notification about an approval that was rolled back reaches somebody.
 */

const selection = {
  id: true,
  type: true,
  title: true,
  body: true,
  payload: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof selection }>;

function buildWhere(userId: string, input: NotificationListInput): Prisma.NotificationWhereInput {
  const where: Prisma.NotificationWhereInput = { userId };

  if (input.onlyUnread) where.readAt = null;
  if (input.type !== undefined) where.type = input.type;

  return where;
}

export async function findMany(
  userId: string,
  input: NotificationListInput,
): Promise<{ rows: NotificationRow[]; totalCount: number }> {
  const where = buildWhere(userId, input);

  const [rows, totalCount] = await db.$transaction([
    db.notification.findMany({
      where,
      select: selection,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor === undefined || input.cursor === null
        ? {}
        : { cursor: { id: input.cursor }, skip: 1 }),
    }),
    db.notification.count({ where }),
  ]);

  return { rows, totalCount };
}

export async function countUnread(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

/**
 * Marks one notification read.
 *
 * Scoped by `userId` in the WHERE clause rather than by a lookup and a check:
 * a notification is addressed to exactly one person, and an update that matches
 * nothing is the correct outcome for somebody else's identifier.
 */
export async function markRead(userId: string, notificationId: string, at: Date): Promise<void> {
  await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: at },
  });
}

export async function markAllRead(userId: string, at: Date): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: at },
  });

  return result.count;
}

export const notificationRepository = {
  findMany,
  countUnread,
  markRead,
  markAllRead,
};

export type NotificationRepository = typeof notificationRepository;
