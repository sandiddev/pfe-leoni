import {
  adjustStockInputSchema,
  recordMovementInputSchema,
  stockByLocationInputSchema,
  stockMovementListInputSchema,
} from "@leoni/contracts";

import { createTRPCRouter, permissionProcedure } from "../../trpc";
import * as service from "./stock.service";

/**
 * Transport for the stock module.
 *
 * `record` and `adjust` are two procedures rather than one with a type field,
 * because the permission differs: any storekeeper moves material, only the
 * Administrator overrides a stock figure. A router cannot branch on a payload
 * to choose a permission, and a service that decided authorisation from the
 * input would be the wrong place for it.
 */
export const stockRouter = createTRPCRouter({
  /** The movement journal, newest first. */
  list: permissionProcedure("stock:read")
    .input(stockMovementListInputSchema)
    .query(async ({ ctx, input }) => service.list({ actor: ctx.actor, input })),

  /** What each shelf holds, in FIFO order. */
  byLocation: permissionProcedure("stock:read")
    .input(stockByLocationInputSchema)
    .query(async ({ ctx, input }) => service.byLocation({ actor: ctx.actor, input })),

  /** Destinations for the movement form. */
  locations: permissionProcedure("stock:read")
    .input(stockByLocationInputSchema)
    .query(async ({ ctx, input }) => service.storageLocations({ actor: ctx.actor, input })),

  /** Records an entry, an exit or a transfer. */
  record: permissionProcedure("stock:move")
    .input(recordMovementInputSchema)
    .mutation(async ({ ctx, input }) => service.record({ actor: ctx.actor, input })),

  /** Overrides the stock level from a physical count. Administrator only. */
  adjust: permissionProcedure("stock:adjust")
    .input(adjustStockInputSchema)
    .mutation(async ({ ctx, input }) => service.adjust({ actor: ctx.actor, input })),
});
