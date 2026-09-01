import { z } from "zod";

import {
  articleParameterInputSchema,
  parameterHistoryInputSchema,
  recalculateInputSchema,
  updateParameterInputSchema,
  upsertArticleParameterInputSchema,
} from "@leoni/contracts";

import { createTRPCRouter, permissionProcedure } from "../../trpc";
import * as service from "./parameter.service";

/**
 * Transport for the tuning parameters.
 *
 * `parameter:read` is held by every role, because a storekeeper looking at a
 * threshold is entitled to see the numbers it came from. Changing them is
 * `parameter:write`, which only the Administrator holds; recalculating is
 * `threshold:recalculate`, which the LTN1 warehouse manager also holds — they
 * are the one who notices a threshold has gone stale.
 */
export const parameterRouter = createTRPCRouter({
  /** The four tunable numbers per ABC class, defaults included. */
  list: permissionProcedure("parameter:read")
    .input(z.object({}))
    .query(async ({ ctx }) => service.list({ actor: ctx.actor })),

  update: permissionProcedure("parameter:write")
    .input(updateParameterInputSchema)
    .mutation(async ({ ctx, input }) => service.update({ actor: ctx.actor, input })),

  /**
   * The parameters in force for one article, and whether they were chosen.
   *
   * `parameter:read`, like the class list: a storekeeper looking at a threshold
   * is entitled to see the numbers behind it.
   */
  forArticle: permissionProcedure("parameter:read")
    .input(articleParameterInputSchema)
    .query(async ({ ctx, input }) => service.forArticle({ actor: ctx.actor, input })),

  /** Overrides one article's parameters (brief section 3.4). */
  upsertForArticle: permissionProcedure("parameter:write")
    .input(upsertArticleParameterInputSchema)
    .mutation(async ({ ctx, input }) => service.upsertForArticle({ actor: ctx.actor, input })),

  /** Drops an override so the article follows its class again. */
  clearForArticle: permissionProcedure("parameter:write")
    .input(articleParameterInputSchema)
    .mutation(async ({ ctx, input }) => service.clearForArticle({ actor: ctx.actor, input })),

  /** Recomputes thresholds from the movement journal, leaving a trail per article. */
  recalculate: permissionProcedure("threshold:recalculate")
    .input(recalculateInputSchema)
    .mutation(async ({ ctx, input }) => service.recalculate({ actor: ctx.actor, input })),

  /** What the last runs produced, so a threshold can be explained (section 3.5). */
  history: permissionProcedure("parameter:read")
    .input(parameterHistoryInputSchema)
    .query(async ({ ctx, input }) => service.history({ actor: ctx.actor, input })),
});
