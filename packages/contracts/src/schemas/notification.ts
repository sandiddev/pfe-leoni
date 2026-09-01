import { z } from "zod";

import type { NotificationType } from "@leoni/core";
import { NOTIFICATION_TYPES } from "@leoni/core";

import { idSchema, paginationSchema } from "./common";

/**
 * The in-app notification centre (brief section 6.1).
 *
 * Rows are written by the services that cause them, inside the same
 * transaction as the change itself — there is no dispatcher and no queue. A
 * notification that survived a rolled-back approval would be worse than a
 * missing one, because somebody would act on it.
 */

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export const notificationListInputSchema = paginationSchema.extend({
  /** Only what has not been read yet, which is what the bell counts. */
  onlyUnread: z.boolean().default(false),
  type: notificationTypeSchema.optional(),
});

export type NotificationListInput = z.infer<typeof notificationListInputSchema>;

export const markNotificationReadInputSchema = z.object({ notificationId: idSchema });

export type MarkNotificationReadInput = z.infer<typeof markNotificationReadInputSchema>;

// --- Outputs ----------------------------------------------------------------

export interface NotificationItem {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string | null;
  /** Present when the notification is about a request, so it can link to it. */
  readonly requestId: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}
