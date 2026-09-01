import { z } from "zod";

import {
  attachmentListInputSchema,
  commentRequestInputSchema,
  createRequestInputSchema,
  deleteAttachmentInputSchema,
  deleteDraftInputSchema,
  idSchema,
  recordAttachmentInputSchema,
  requestByIdInputSchema,
  requestListInputSchema,
  transitionRequestInputSchema,
  updateDraftInputSchema,
} from "@leoni/contracts";

import { createTRPCRouter, permissionProcedure } from "../../trpc";
import * as service from "./request.service";

/**
 * Transport for the replenishment workflow.
 *
 * `transition` is one procedure for all fifteen actions, and its permission is
 * deliberately the weakest of them: `request:read`. That is not a hole. The
 * authority to perform a specific action lives in the domain transition table,
 * which lists the roles allowed to make each move, and `assertTransition`
 * enforces it inside the service — where the request's *current state* is
 * known, which is exactly what a procedure-level permission cannot see.
 *
 * `transitions.test.ts` in `@leoni/core` keeps that table in agreement with the
 * permission matrix, in both directions, so the two statements of the rule
 * cannot drift.
 */
export const requestRouter = createTRPCRouter({
  /** The request list, with the derived late indicator. */
  list: permissionProcedure("request:read")
    .input(requestListInputSchema)
    .query(async ({ ctx, input }) => service.list({ actor: ctx.actor, input })),

  /** One request: lines, trail, comments, and the buttons this role may press. */
  byId: permissionProcedure("request:read")
    .input(requestByIdInputSchema)
    .query(async ({ ctx, input }) => service.byId({ actor: ctx.actor, input })),

  create: permissionProcedure("request:create")
    .input(createRequestInputSchema)
    .mutation(async ({ ctx, input }) => service.create({ actor: ctx.actor, input })),

  /**
   * Corrects a draft. Refused past `DRAFT`, and for anyone but its author.
   *
   * `request:create` is the right permission: this is still the act of raising
   * a request, finished later. Ownership is checked in the service, where the
   * request's author is known.
   */
  updateDraft: permissionProcedure("request:create")
    .input(updateDraftInputSchema)
    .mutation(async ({ ctx, input }) => service.updateDraft({ actor: ctx.actor, input })),

  /** Discards a draft. Anything submitted is cancelled with a reason instead. */
  deleteDraft: permissionProcedure("request:create")
    .input(deleteDraftInputSchema)
    .mutation(async ({ ctx, input }) => service.deleteDraft({ actor: ctx.actor, input })),

  transition: permissionProcedure("request:read")
    .input(transitionRequestInputSchema)
    .mutation(async ({ ctx, input }) => service.transition({ actor: ctx.actor, input })),

  comment: permissionProcedure("request:comment")
    .input(commentRequestInputSchema)
    .mutation(async ({ ctx, input }) => service.comment({ actor: ctx.actor, input })),

  attachments: createTRPCRouter({
    list: permissionProcedure("request:read")
      .input(attachmentListInputSchema)
      .query(async ({ ctx, input }) => service.listAttachments({ actor: ctx.actor, input })),

    /**
     * Records a file the upload route has already written.
     *
     * Not callable usefully from a browser: the storage path it takes is
     * produced by the route handler, and a fabricated one points at nothing.
     * The download route resolves the path itself and never trusts the client.
     */
    /**
     * Asked by the upload route before it writes a byte to disk.
     *
     * A query, because it changes nothing: it answers "may this caller attach to
     * this request" so the route can refuse a stranger before the volume is
     * touched, rather than after.
     */
    canUpload: permissionProcedure("request:comment")
      .input(z.object({ requestId: idSchema }))
      .query(async ({ ctx, input }) => service.assertCanAttach({ actor: ctx.actor, input })),

    record: permissionProcedure("request:comment")
      .input(recordAttachmentInputSchema)
      .mutation(async ({ ctx, input }) => service.recordAttachment({ actor: ctx.actor, input })),

    /**
     * Where a file lives, once the caller is allowed to read it.
     *
     * Used by the download route handler. A query rather than something the
     * handler works out itself, so the site check runs in the same place as
     * every other read of a request.
     */
    forDownload: permissionProcedure("request:read")
      .input(deleteAttachmentInputSchema)
      .query(async ({ ctx, input }) => service.attachmentForDownload({ actor: ctx.actor, input })),

    remove: permissionProcedure("request:comment")
      .input(deleteAttachmentInputSchema)
      .mutation(async ({ ctx, input }) => service.removeAttachment({ actor: ctx.actor, input })),
  }),
});
