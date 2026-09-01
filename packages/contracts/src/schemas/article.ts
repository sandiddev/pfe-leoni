import { z } from "zod";

import type { MeasurementUnit, MovementType, RecalculationTrigger } from "@leoni/core";
import { MEASUREMENT_UNITS } from "@leoni/core";

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
/**
 * How the article is counted.
 *
 * From `MEASUREMENT_UNITS` in the domain, so a value the database can store and
 * the label maps cannot translate is impossible to submit.
 */
export const measurementUnitSchema = z.enum(MEASUREMENT_UNITS);

export const createArticleInputSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(2, "Reference requise")
    .max(64, "Reference trop longue")
    .transform((value) => value.toUpperCase()),
  designation: z.string().trim().min(2, "Designation requise").max(200),
  unit: measurementUnitSchema.default("PIECE"),
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
  unit: measurementUnitSchema,
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
  readonly unit: MeasurementUnit;
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
  /** `null` for stock that predates batch capture, or that never had one. */
  readonly batchReference: string | null;
  readonly supplierReference: string | null;
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

// --- CSV import (brief section 6.1) -----------------------------------------

/**
 * The column contract for a catalogue import.
 *
 * Defined here rather than inferred from whatever spreadsheet arrives. No real
 * export was supplied, and guessing at somebody else's column names is how an
 * import silently maps `delai` onto `vpe` and corrupts the catalogue. The
 * application states the format and offers a model file; a source system is
 * mapped onto it once, by hand, outside the application.
 *
 * Order is the order of the model file. `siteCode` is last because it is the
 * only column that is not a property of the article itself — it says which
 * plant the opening stock belongs to.
 */
export const ARTICLE_IMPORT_COLUMNS = [
  "reference",
  "designation",
  "unit",
  "vpe",
  "leadTimeDays",
  "abcClass",
  "initialStock",
  "siteCode",
] as const;

export type ArticleImportColumn = (typeof ARTICLE_IMPORT_COLUMNS)[number];

/** French headers for the model file, in the same order. */
export const ARTICLE_IMPORT_HEADERS_FR: Readonly<Record<ArticleImportColumn, string>> = {
  reference: "Reference",
  designation: "Designation",
  unit: "Unite",
  vpe: "VPE",
  leadTimeDays: "Delai (jours)",
  abcClass: "Classe ABC",
  initialStock: "Stock initial",
  siteCode: "Site",
};

/** A whole number arriving as text from a spreadsheet cell. */
const csvIntegerSchema = z
  .string()
  .trim()
  .refine((value) => /^\d+$/.test(value), "Nombre entier positif attendu")
  .transform((value) => Number(value));

/**
 * One row of the import file.
 *
 * Every field arrives as text, so the coercions are explicit: a spreadsheet has
 * no types, and `Number("")` is 0 — which would silently import a pack size of
 * zero and make every proposed quantity a division by nothing.
 */
export const articleImportRowSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(2, "Reference requise")
    .max(64, "Reference trop longue")
    .transform((value) => value.toUpperCase()),
  designation: z.string().trim().min(2, "Designation requise").max(200),
  unit: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(measurementUnitSchema),
  vpe: csvIntegerSchema.refine((value) => value > 0, "La VPE doit etre superieure a zero"),
  leadTimeDays: csvIntegerSchema.refine((value) => value <= 365, "Delai irrealiste"),
  abcClass: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(abcClassSchema),
  initialStock: csvIntegerSchema,
  siteCode: z
    .string()
    .trim()
    .min(2, "Code site requis")
    .transform((value) => value.toUpperCase()),
});

export type ArticleImportRow = z.infer<typeof articleImportRowSchema>;

/** What went wrong on one line, addressed the way a spreadsheet numbers it. */
export interface ArticleImportError {
  /** 1-based, counting the header as line 1, so it matches the editor's gutter. */
  readonly line: number;
  readonly column: string | null;
  readonly message: string;
}

/**
 * The outcome of an import attempt.
 *
 * `imported` and `updated` are zero whenever `errors` is non-empty: the whole
 * file is validated before anything is written. A half-imported catalogue is
 * the failure mode that costs a day to unpick, and "which rows made it" is not
 * a question anybody can answer from the outside.
 */
export interface ArticleImportResult {
  readonly rows: number;
  readonly imported: number;
  readonly updated: number;
  readonly errors: readonly ArticleImportError[];
}
