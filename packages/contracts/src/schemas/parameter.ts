import { z } from "zod";

import type { AbcClass, RecalculationTrigger } from "@leoni/core";
import { AVERAGING_WINDOWS } from "@leoni/core";

import { abcClassSchema, idSchema } from "./common";

/**
 * The tuning parameters (brief section 3.4).
 *
 * Every number the logistics team might want to change is a row in
 * `ReplenishmentParameter`, never a constant in source. That is a hard
 * requirement of the brief, and this module is what makes it true from a form
 * rather than from a redeployment.
 */

/**
 * The permitted averaging windows.
 *
 * 7, 30 or 90 days, from `AVERAGING_WINDOWS` in the domain: a class C reference
 * with sporadic demand is badly represented by a 7-day window, and a class A
 * one reacts too slowly on 90. A free number would let someone pick 1.
 */
export const averagingWindowSchema = z.union([
  z.literal(AVERAGING_WINDOWS[0]),
  z.literal(AVERAGING_WINDOWS[1]),
  z.literal(AVERAGING_WINDOWS[2]),
]);

export const updateParameterInputSchema = z.object({
  abcClass: abcClassSchema,
  safetyDays: z.number().min(0, "Le stock de securite ne peut pas etre negatif").max(60),
  extraCoverageDays: z
    .number()
    .min(0, "La couverture additionnelle ne peut pas etre negative")
    .max(180),
  averagingWindowDays: averagingWindowSchema,
  warningMarginRatio: z
    .number()
    .min(0, "La marge d alerte ne peut pas etre negative")
    .max(1, "La marge d alerte s exprime en fraction du seuil mini"),
});

export type UpdateParameterInput = z.infer<typeof updateParameterInputSchema>;

/**
 * A parameter override for one article (brief section 3.4).
 *
 * `ReplenishmentParameter` carries either an `abcClass` or an `articleId`,
 * never both. An article-level row lets a single critical reference be treated
 * more conservatively than the rest of its class, which is the whole reason the
 * column exists.
 */
export const articleParameterInputSchema = z.object({ articleId: idSchema });

export type ArticleParameterInput = z.infer<typeof articleParameterInputSchema>;

export const upsertArticleParameterInputSchema = z.object({
  articleId: idSchema,
  safetyDays: z.number().min(0, "Le stock de securite ne peut pas etre negatif").max(60),
  extraCoverageDays: z
    .number()
    .min(0, "La couverture additionnelle ne peut pas etre negative")
    .max(180),
  averagingWindowDays: averagingWindowSchema,
  warningMarginRatio: z
    .number()
    .min(0, "La marge d alerte ne peut pas etre negative")
    .max(1, "La marge d alerte s exprime en fraction du seuil mini"),
});

export type UpsertArticleParameterInput = z.infer<typeof upsertArticleParameterInputSchema>;

export const recalculateInputSchema = z.object({
  siteId: idSchema.optional(),
  /** Limit the run to one class, for a targeted re-tune. */
  abcClass: abcClassSchema.optional(),
});

export type RecalculateInput = z.infer<typeof recalculateInputSchema>;

export const parameterHistoryInputSchema = z.object({
  siteId: idSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type ParameterHistoryInput = z.infer<typeof parameterHistoryInputSchema>;

// --- Outputs ----------------------------------------------------------------

export interface ParameterItem {
  readonly abcClass: AbcClass;
  readonly safetyDays: number;
  readonly extraCoverageDays: number;
  readonly averagingWindowDays: number;
  readonly warningMarginRatio: number;
  /** True when no row exists yet and `DEFAULT_CLASS_PARAMETERS` is in force. */
  readonly isDefault: boolean;
  readonly updatedAt: Date | null;
}

/**
 * The parameters in force for one article, and where they come from.
 *
 * `source` is the point: a screen has to distinguish "these are the class
 * defaults" from "somebody chose these for this reference", because clearing
 * an override is only meaningful in the second case.
 */
export interface ArticleParameters {
  readonly articleId: string;
  readonly safetyDays: number;
  readonly extraCoverageDays: number;
  readonly averagingWindowDays: number;
  readonly warningMarginRatio: number;
  readonly source: "ARTICLE" | "CLASS";
  readonly abcClass: AbcClass;
}

/** One line of the recalculation history (brief section 3.5). */
export interface RecalculationHistoryItem {
  readonly id: string;
  readonly reference: string;
  readonly designation: string;
  readonly siteCode: string;
  readonly averageDailyConsumption: number;
  readonly minThreshold: number;
  readonly maxThreshold: number;
  readonly safetyStock: number;
  readonly trigger: RecalculationTrigger;
  readonly computedAt: Date;
}

/** What a recalculation run changed, reported back to the screen. */
export interface RecalculationResult {
  readonly evaluated: number;
  readonly changed: number;
  readonly nowCritical: number;
  /**
   * Articles the Pareto pass moved to a different class (brief section 5).
   *
   * Reported separately from `changed` because it is a different kind of
   * change: a threshold moving is the model responding to demand, while a class
   * moving means the *parameters* an article is governed by have changed, which
   * is worth a second look from whoever ran it.
   */
  readonly reclassified: number;
  readonly runAt: Date;
}
