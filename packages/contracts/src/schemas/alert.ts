import { z } from "zod";

import type { AlertLevel } from "@leoni/core";

import type { ArticleListItem } from "./article";
import { abcClassSchema, alertLevelSchema, idSchema, paginationSchema } from "./common";

/**
 * The alert board (brief section 6.1).
 *
 * The board answers one question — what needs replenishing, most urgent first —
 * so its input is deliberately narrow and its output is the article row the
 * catalogue already defines. A second DTO carrying the same twenty fields would
 * be a second thing to keep in step with `assessStockItem`.
 */

export const alertBoardInputSchema = paginationSchema.extend({
  siteId: idSchema.optional(),
  /** Narrow to one severity. Omitted, the board shows everything at risk. */
  level: alertLevelSchema.optional(),
  abcClass: abcClassSchema.optional(),
  /**
   * Include articles that are comfortably stocked. Off by default: a board that
   * lists every reference is a catalogue, and the storekeeper already has one.
   */
  includeNormal: z.boolean().default(false),
});

export type AlertBoardInput = z.infer<typeof alertBoardInputSchema>;

export const alertSummaryInputSchema = z.object({ siteId: idSchema.optional() });

export type AlertSummaryInput = z.infer<typeof alertSummaryInputSchema>;

/**
 * A row of the board.
 *
 * Identical to the catalogue row on purpose: the alert level, the coverage and
 * the suggested quantity are computed by the same `assessStockItem` call, and
 * the board differs only in which rows it selects and how it orders them.
 */
export type AlertBoardItem = ArticleListItem;

/** How many articles sit at each severity, for the dashboard tiles. */
export type AlertSummary = Readonly<Record<AlertLevel, number>> & {
  /** Articles at or below their reorder point: the two levels that act. */
  readonly actionable: number;
};
