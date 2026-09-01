import { z } from "zod";

import { MOVEMENT_TYPES, type MovementType } from "@leoni/core";

import {
  idSchema,
  paginationSchema,
  positiveQuantitySchema,
  quantitySchema,
  reasonSchema,
  searchSchema,
} from "./common";

/**
 * The stock journal and the movements that write it.
 *
 * Every change to `StockItem.currentStock` is one of these, which is what makes
 * a stock level explainable and the consumption average computable. The inputs
 * below are therefore the narrowest part of the API: a movement that should not
 * have been possible is a discrepancy somebody counts by hand later.
 */

export const movementTypeSchema = z.enum(MOVEMENT_TYPES);

// --- Inputs -----------------------------------------------------------------

export const stockMovementListInputSchema = paginationSchema.extend({
  search: searchSchema,
  siteId: idSchema.optional(),
  articleId: idSchema.optional(),
  type: movementTypeSchema.optional(),
  storageLocationId: idSchema.optional(),
  /** Inclusive lower bound on `occurredAt`. */
  from: z.date().optional(),
  /** Inclusive upper bound on `occurredAt`. */
  to: z.date().optional(),
});

export type StockMovementListInput = z.infer<typeof stockMovementListInputSchema>;

/**
 * Recording a movement.
 *
 * `ADJUSTMENT` is deliberately not accepted here: an inventory correction needs
 * a different permission and a mandatory reason, so it has its own input rather
 * than a flag on this one. A router cannot branch on a field to pick a
 * permission, and a service that decided authorisation from the payload would
 * be exactly the wrong place for it.
 */
export const recordMovementInputSchema = z.object({
  articleId: idSchema,
  siteId: idSchema.optional(),
  type: z.enum(["ENTRY", "EXIT", "TRANSFER_IN", "TRANSFER_OUT"]),
  quantity: positiveQuantitySchema,
  /**
   * Where the material lands. Required on an inbound movement — stock that is
   * in the store but on no shelf cannot be picked. Ignored on an outbound one,
   * where FIFO chooses the lots.
   */
  storageLocationId: idSchema.optional(),
  /** Defaults to now in the service; the clock is not read in the browser. */
  occurredAt: z.date().optional(),
  /** Delivery note, request code, or the ERP document this came from. */
  reference: z.string().trim().max(64).optional(),
});

export type RecordMovementInput = z.infer<typeof recordMovementInputSchema>;

/**
 * An inventory count. Administrator only (`stock:adjust`).
 *
 * The counted quantity replaces the level rather than adjusting it by a delta,
 * because the number a discrepancy investigation needs months later is what was
 * physically on the shelf, not the difference from what the system believed.
 */
export const adjustStockInputSchema = z.object({
  articleId: idSchema,
  siteId: idSchema.optional(),
  countedQuantity: quantitySchema,
  /** Where the surplus lands when the count is higher than the system's level. */
  storageLocationId: idSchema.optional(),
  reason: reasonSchema,
});

export type AdjustStockInput = z.infer<typeof adjustStockInputSchema>;

export const stockByLocationInputSchema = z.object({
  siteId: idSchema.optional(),
  storageLocationId: idSchema.optional(),
});

export type StockByLocationInput = z.infer<typeof stockByLocationInputSchema>;

// --- Outputs ----------------------------------------------------------------

/** One line of the journal. */
export interface StockMovementListItem {
  readonly id: string;
  readonly type: MovementType;
  readonly quantity: number;
  readonly occurredAt: Date;
  readonly reference: string | null;
  readonly userName: string | null;

  readonly articleId: string;
  readonly articleReference: string;
  readonly articleDesignation: string;

  readonly siteCode: string;
  readonly locationCode: string | null;
}

/** What a shelf holds, for the picking and inventory screens. */
export interface StockByLocationItem {
  readonly lotId: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly articleId: string;
  readonly articleReference: string;
  readonly articleDesignation: string;
  readonly quantity: number;
  readonly fifoDate: Date;
}

/** A storage location, for the movement form's destination select. */
export interface StorageLocationOption {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
  readonly siteId: string;
}

/** What a recorded movement changed, so the screen can confirm it in figures. */
export interface RecordMovementResult {
  readonly movementId: string;
  readonly stockItemId: string;
  readonly previousStock: number;
  readonly newStock: number;
  readonly alertLevel: "NORMAL" | "WARNING" | "CRITICAL" | "RUPTURE";
}
