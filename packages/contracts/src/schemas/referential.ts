import { z } from "zod";

import type { SiteType } from "@leoni/core";
import { SITE_TYPES } from "@leoni/core";

import { idSchema } from "./common";

/**
 * Plant master data: the sites and the shelves inside them.
 *
 * One module because they are one concern and one transaction boundary — a
 * location belongs to exactly one site, and deleting either has consequences
 * for the stock sitting on it.
 */

export const siteTypeSchema = z.enum(SITE_TYPES);

const siteCodeSchema = z
  .string()
  .trim()
  .min(2, "Code requis")
  .max(16, "Code trop long")
  .transform((value) => value.toUpperCase());

export const createSiteInputSchema = z.object({
  code: siteCodeSchema,
  name: z.string().trim().min(2, "Nom requis").max(120),
  type: siteTypeSchema,
});

export type CreateSiteInput = z.infer<typeof createSiteInputSchema>;

export const updateSiteInputSchema = z.object({
  siteId: idSchema,
  name: z.string().trim().min(2, "Nom requis").max(120),
  type: siteTypeSchema,
});

export type UpdateSiteInput = z.infer<typeof updateSiteInputSchema>;

export const createLocationInputSchema = z.object({
  siteId: idSchema,
  code: z
    .string()
    .trim()
    .min(1, "Code requis")
    .max(32, "Code trop long")
    .transform((value) => value.toUpperCase()),
  description: z.string().trim().max(200).optional(),
});

export type CreateLocationInput = z.infer<typeof createLocationInputSchema>;

export const updateLocationInputSchema = z.object({
  storageLocationId: idSchema,
  code: z
    .string()
    .trim()
    .min(1, "Code requis")
    .max(32)
    .transform((value) => value.toUpperCase()),
  description: z.string().trim().max(200).optional(),
});

export type UpdateLocationInput = z.infer<typeof updateLocationInputSchema>;

export const deleteLocationInputSchema = z.object({ storageLocationId: idSchema });

export type DeleteLocationInput = z.infer<typeof deleteLocationInputSchema>;

export const locationListInputSchema = z.object({ siteId: idSchema.optional() });

export type LocationListInput = z.infer<typeof locationListInputSchema>;

// --- Outputs ----------------------------------------------------------------

export interface SiteItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: SiteType;
  readonly locationCount: number;
  /** Requests at either end. A site with any of these cannot change direction. */
  readonly requestCount: number;
}

export interface LocationItem {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
  readonly siteId: string;
  readonly siteCode: string;
  /** Lots currently on the shelf. Non-zero means it cannot be deleted. */
  readonly lotCount: number;
  readonly totalQuantity: number;
}
