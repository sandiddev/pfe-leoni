import { z } from "zod";

import type { MovementType, RecalculationTrigger } from "@leoni/core";

import {
  abcClassSchema,
  alertLevelSchema,
  idSchema,
  paginationSchema,
  positiveQuantitySchema,
  quantitySchema,
  searchSchema,
  sortDirectionSchema,
} from "./common";

/**
 * Article master data and the stock view built on top of it.
 *
 * This module is the reference for every other feature: the same three shapes
 * appear everywhere — a filter input, an output DTO, and a mutation input — and
 * every module should follow this file rather than invent its own arrangement.
 */

// --- Inputs -----------------------------------------------------------------

export const articleSortFieldSchema = z
  .enum(["reference", "designation", "currentStock", "coverageDays", "alertLevel"])
  .default("reference");

/**
 * Filters for the article list.
 *
 * `siteId` is accepted but never trusted: the server intersects it with what
 * the caller's role and plant actually allow. A filter is a convenience for the
 * user, not an authorisation decision.
 */
export const articleListInputSchema = paginationSchema.extend({
  search: searchSchema,
  siteId: idSchema.optional(),
  abcClass: abcClassSchema.optional(),
  alertLevel: alertLevelSchema.optional(),
  storageLocationId: idSchema.optional(),
  /** Only articles at or below their reorder point. */
  onlyReplenishable: z.boolean().default(false),
  includeInactive: z.boolean().default(false),
  sortBy: articleSortFieldSchema,
  sortDirection: sortDirectionSchema,
});

export type ArticleListInput = z.infer<typeof articleListInputSchema>;

export const articleByIdInputSchema = z.object({
  articleId: idSchema,
  siteId: idSchema.optional(),
});

export type ArticleByIdInput = z.infer<typeof articleByIdInputSchema>;

/**
 * Creating an article. Administrator only.
 *
 * The reference is the identity a storekeeper reads off a bin label, so it is
 * validated harder than the rest: trimmed, upper-cased and unique. Everything
 * else about the article can be corrected later; a duplicated reference is two
 * bins nobody can tell apart.
 */
export const createArticleInputSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(2, "Reference requise")
    .max(64, "Reference trop longue")
    .transform((value) => value.toUpperCase()),
  designation: z.string().trim().min(2, "Designation requise").max(200),
  vpe: positiveQuantitySchema,
  leadTimeDays: z
    .number()
    .int()
    .min(0, "Le delai ne peut pas etre negatif")
    .max(365, "Delai irrealiste"),
  abcClass: abcClassSchema,
  /** Opening quantity per plant, if the shelves are not empty. */
  initialStock: quantitySchema.default(0),
});

export type CreateArticleInput = z.infer<typeof createArticleInputSchema>;

/** Master-data edit. Administrator only (brief section 4). */
export const updateArticleInputSchema = z.object({
  articleId: idSchema,
  designation: z.string().trim().min(2, "Designation requise").max(200),
  vpe: positiveQuantitySchema,
  leadTimeDays: z
    .number()
    .int()
    .min(0, "Le delai ne peut pas etre negatif")
    .max(365, "Delai irrealiste"),
  abcClass: abcClassSchema,
  isActive: z.boolean(),
});

export type UpdateArticleInput = z.infer<typeof updateArticleInputSchema>;

// --- Outputs ----------------------------------------------------------------

/**
 * One row of the article list.
 *
 * The computed fields — alert level, coverage, the suggested order — are
 * returned by the server rather than derived in the browser. The rule that
 * decides them lives in `@leoni/core`, and reimplementing it in a React
 * component would create a second version of the business logic that nobody
 * unit-tests and that silently disagrees with the CSV export.
 */
export interface ArticleListItem {
  readonly articleId: string;
  readonly stockItemId: string;
  readonly reference: string;
  readonly designation: string;
  readonly abcClass: "A" | "B" | "C";
  readonly vpe: number;
  readonly leadTimeDays: number;
  readonly isActive: boolean;

  readonly siteId: string;
  readonly siteCode: string;

  readonly currentStock: number;
  readonly averageDailyConsumption: number;
  readonly minThreshold: number;
  readonly maxThreshold: number;
  readonly safetyStock: number;

  readonly alertLevel: "NORMAL" | "WARNING" | "CRITICAL" | "RUPTURE";
  /** `null` when the article has no measured consumption. */
  readonly coverageDays: number | null;
  readonly willRunOutBeforeResupply: boolean;

  readonly isReplenishmentNeeded: boolean;
  readonly need: number;
  readonly boxCount: number;
  readonly recommendedQuantity: number;

  readonly lastRecalculatedAt: Date | null;
}

/** A point on the article's threshold history (brief section 3.5). */
export interface ThresholdHistoryPoint {
  readonly computedAt: Date;
  readonly averageDailyConsumption: number;
  readonly minThreshold: number;
  readonly maxThreshold: number;
  readonly safetyStock: number;
  readonly trigger: RecalculationTrigger;
}

/** A movement in the article's journal. */
export interface StockMovementItem {
  readonly id: string;
  readonly type: MovementType;
  readonly quantity: number;
  readonly occurredAt: Date;
  readonly reference: string | null;
  readonly userName: string | null;
}

/** A lot held for this article, ordered FIFO. */
export interface StockLotItem {
  readonly id: string;
  readonly quantity: number;
  readonly fifoDate: Date;
  readonly locationCode: string;
}

/**
 * The logistics study's original formulas applied to the same article
 * (brief section 3.1), so the enrichment can be defended with numbers rather
 * than argument. See `computeLegacyThresholds` in @leoni/core.
 */
export interface LegacyThresholdComparison {
  readonly min: number;
  readonly max: number;
}

/** The article detail screen. */
export interface ArticleDetail extends ArticleListItem {
  readonly lots: readonly StockLotItem[];
  readonly recentMovements: readonly StockMovementItem[];
  readonly thresholdHistory: readonly ThresholdHistoryPoint[];
  readonly legacyThresholds: LegacyThresholdComparison;
}
