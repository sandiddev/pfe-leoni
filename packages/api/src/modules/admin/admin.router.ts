import { z } from "zod";

import {
  auditListInputSchema,
  createUserInputSchema,
  resetPasswordInputSchema,
  updateUserInputSchema,
  userListInputSchema,
} from "@leoni/contracts";

import { createTRPCRouter, permissionProcedure } from "../../trpc";
import * as service from "./admin.service";

/**
 * Transport for user administration and the audit log.
 *
 * `user:read` and `user:write` are Administrator-only. `audit:read` is not: the
 * Logistics Manager holds it too, because steering the process means being able
 * to see who changed the numbers it runs on.
 */
export const adminRouter = createTRPCRouter({
  users: createTRPCRouter({
    list: permissionProcedure("user:read")
      .input(userListInputSchema)
      .query(async ({ ctx, input }) => service.listUsers({ actor: ctx.actor, input })),

    /**
     * Provisions an account and returns its password once.
     *
     * Sign-up stays disabled: an account comes into existence here, on an
     * Administrator's decision, or not at all (brief section 4).
     */
    create: permissionProcedure("user:write")
      .input(createUserInputSchema)
      .mutation(async ({ ctx, input }) => service.createUser({ actor: ctx.actor, input })),

    /** A new password, and every open session for that account ended. */
    resetPassword: permissionProcedure("user:write")
      .input(resetPasswordInputSchema)
      .mutation(async ({ ctx, input }) => service.resetPassword({ actor: ctx.actor, input })),

    /** Role, plant and access. */
    update: permissionProcedure("user:write")
      .input(updateUserInputSchema)
      .mutation(async ({ ctx, input }) => service.updateUser({ actor: ctx.actor, input })),

    sites: permissionProcedure("user:read")
      .input(z.object({}))
      .query(async ({ ctx }) => service.listSites({ actor: ctx.actor })),
  }),

  audit: createTRPCRouter({
    list: permissionProcedure("audit:read")
      .input(auditListInputSchema)
      .query(async ({ ctx, input }) => service.listAudit({ actor: ctx.actor, input })),

    /** The entities that actually appear in the log, for the filter. */
    entities: permissionProcedure("audit:read")
      .input(z.object({}))
      .query(async ({ ctx }) => service.listAuditedEntities({ actor: ctx.actor })),
  }),
});
