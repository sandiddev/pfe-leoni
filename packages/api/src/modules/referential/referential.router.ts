import { z } from "zod";

import {
  createLocationInputSchema,
  createSiteInputSchema,
  deleteLocationInputSchema,
  locationListInputSchema,
  updateLocationInputSchema,
  updateSiteInputSchema,
} from "@leoni/contracts";

import { createTRPCRouter, permissionProcedure } from "../../trpc";
import * as service from "./referential.service";

/**
 * Transport for plant master data.
 *
 * Sites are `user:write` — Administrator only, because adding a plant changes
 * what every role means. Locations are `stock:adjust`, which the Administrator
 * also holds alone today, but the permission says the right thing: rearranging
 * shelves is a stock decision, not an organisational one.
 */
export const referentialRouter = createTRPCRouter({
  sites: createTRPCRouter({
    list: permissionProcedure("stock:read")
      .input(z.object({}))
      .query(async ({ ctx }) => service.listSites({ actor: ctx.actor })),

    create: permissionProcedure("user:write")
      .input(createSiteInputSchema)
      .mutation(async ({ ctx, input }) => service.createSite({ actor: ctx.actor, input })),

    update: permissionProcedure("user:write")
      .input(updateSiteInputSchema)
      .mutation(async ({ ctx, input }) => service.updateSite({ actor: ctx.actor, input })),
  }),

  locations: createTRPCRouter({
    list: permissionProcedure("stock:read")
      .input(locationListInputSchema)
      .query(async ({ ctx, input }) => service.listLocations({ actor: ctx.actor, input })),

    create: permissionProcedure("stock:adjust")
      .input(createLocationInputSchema)
      .mutation(async ({ ctx, input }) => service.createLocation({ actor: ctx.actor, input })),

    update: permissionProcedure("stock:adjust")
      .input(updateLocationInputSchema)
      .mutation(async ({ ctx, input }) => service.updateLocation({ actor: ctx.actor, input })),

    /** Refused while the shelf holds stock — the service says what is on it. */
    remove: permissionProcedure("stock:adjust")
      .input(deleteLocationInputSchema)
      .mutation(async ({ ctx, input }) => service.deleteLocation({ actor: ctx.actor, input })),
  }),
});
