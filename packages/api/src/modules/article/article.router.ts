import { z } from "zod";

import {
  articleByIdInputSchema,
  articleListInputSchema,
  createArticleInputSchema,
  updateArticleInputSchema,
} from "@leoni/contracts";

import { createTRPCRouter, permissionProcedure } from "../../trpc";
import * as service from "./article.service";

/**
 * Transport for the article module.
 *
 * A router does exactly three things: validate the input against a schema,
 * declare the permission the operation requires, and call the service. There is
 * no business rule in this file and there should never be one — if a condition
 * belongs to the process rather than to HTTP, it belongs in the service, where
 * it can be unit-tested without a request.
 *
 * This is the reference shape for every other module.
 */
export const articleRouter = createTRPCRouter({
  /** Paginated article list with the computed alert and suggestion columns. */
  list: permissionProcedure("article:read")
    .input(articleListInputSchema)
    .query(async ({ ctx, input }) => service.list({ actor: ctx.actor, input })),

  /** One article at one plant, with its lots, journal and threshold history. */
  byId: permissionProcedure("article:read")
    .input(articleByIdInputSchema)
    .query(async ({ ctx, input }) => service.byId({ actor: ctx.actor, input })),

  /**
   * Adds a reference to the catalogue, with its stock row at every plant.
   *
   * Same permission as the edit: what an article's Min, Max, VPE and lead time
   * are is an Administrator's decision, and so is whether it exists.
   */
  create: permissionProcedure("article:write")
    .input(createArticleInputSchema)
    .mutation(async ({ ctx, input }) => service.create({ actor: ctx.actor, input })),

  /**
   * Master data edit.
   *
   * `article:write` is held only by the Administrator (brief section 4), so the
   * permission alone expresses the rule that Min, Max, Lead Time, VPE and ABC
   * class are not editable by the plants.
   */
  update: permissionProcedure("article:write")
    .input(updateArticleInputSchema)
    .mutation(async ({ ctx, input }) => service.update({ actor: ctx.actor, input })),

  /**
   * Imports a catalogue from a CSV export (brief section 6.1).
   *
   * Takes the already-decoded text rather than the file: multipart is the route
   * handler's problem, and a procedure that took bytes would need to know about
   * encodings to be callable from a test. Same permission as creating one
   * article by hand — an import creates and edits master data.
   */
  import: permissionProcedure("article:write")
    .input(z.object({ content: z.string().min(1, "Fichier vide").max(5_000_000) }))
    .mutation(async ({ ctx, input }) =>
      service.importFromCsv({ actor: ctx.actor, content: input.content }),
    ),
});
