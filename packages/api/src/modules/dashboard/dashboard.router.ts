import { dashboardExportInputSchema, dashboardInputSchema } from "@leoni/contracts";

import { createTRPCRouter, permissionProcedure } from "../../trpc";
import * as service from "./dashboard.service";

/**
 * Transport for the KPIs.
 *
 * `dashboard:read` is held by every role — a storekeeper who cannot see the
 * stock-out rate has no way to know whether their work is helping. The export
 * is separate because `report:export` is a distinct decision: taking figures
 * out of the application is what gets forwarded to people outside it.
 */
export const dashboardRouter = createTRPCRouter({
  summary: permissionProcedure("dashboard:read")
    .input(dashboardInputSchema)
    .query(async ({ ctx, input }) => service.summary({ actor: ctx.actor, input })),

  /** The same series as a CSV, generated server side so it cannot drift. */
  export: permissionProcedure("report:export")
    .input(dashboardExportInputSchema)
    .query(async ({ ctx, input }) => service.exportCsv({ actor: ctx.actor, input })),
});
