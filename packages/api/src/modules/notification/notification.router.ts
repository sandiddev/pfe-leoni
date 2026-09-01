import { z } from "zod";

import { markNotificationReadInputSchema, notificationListInputSchema } from "@leoni/contracts";

import { createTRPCRouter, permissionProcedure } from "../../trpc";
import * as service from "./notification.service";

/**
 * Transport for the notification centre.
 *
 * Guarded by `alert:read`, which every role holds — a notification addressed to
 * someone that they may not read would be a strange thing to have written. The
 * real boundary is not the permission but the identity: every procedure below
 * is scoped to `ctx.actor.userId` in the service, so no input can reach another
 * person's notifications.
 */
export const notificationRouter = createTRPCRouter({
  list: permissionProcedure("alert:read")
    .input(notificationListInputSchema)
    .query(async ({ ctx, input }) => service.list({ actor: ctx.actor, input })),

  /** What the bell in the top bar shows. */
  unreadCount: permissionProcedure("alert:read")
    .input(z.object({}))
    .query(async ({ ctx }) => service.unreadCount({ actor: ctx.actor })),

  markRead: permissionProcedure("alert:read")
    .input(markNotificationReadInputSchema)
    .mutation(async ({ ctx, input }) => service.markRead({ actor: ctx.actor, input })),

  markAllRead: permissionProcedure("alert:read")
    .input(z.object({}))
    .mutation(async ({ ctx }) => service.markAllRead({ actor: ctx.actor })),
});
