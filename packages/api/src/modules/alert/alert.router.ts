import { alertBoardInputSchema, alertSummaryInputSchema } from "@leoni/contracts";

import { createTRPCRouter, permissionProcedure } from "../../trpc";
import * as service from "./alert.service";

/**
 * Transport for the alert board.
 *
 * Every role holds `alert:read` — an alert nobody is allowed to see is not an
 * alert. Acting on one is what the request module's permissions govern.
 */
export const alertRouter = createTRPCRouter({
  /** Articles at risk, most severe first, with the quantity to order. */
  board: permissionProcedure("alert:read")
    .input(alertBoardInputSchema)
    .query(async ({ ctx, input }) => service.board({ actor: ctx.actor, input })),

  /** Counts per severity, for the dashboard tiles and the sidebar badge. */
  summary: permissionProcedure("alert:read")
    .input(alertSummaryInputSchema)
    .query(async ({ ctx, input }) => service.summary({ actor: ctx.actor, input })),
});
