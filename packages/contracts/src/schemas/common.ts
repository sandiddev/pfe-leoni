import { z } from "zod";

import { ABC_CLASSES, ALERT_LEVELS, REQUEST_STATUSES, ROLES } from "@leoni/core";

/**
 * Shared input primitives.
 *
 * A Zod schema is the single source of truth for a shape: the TypeScript type
 * is always derived with `z.infer`, never hand-written alongside it. Two
 * declarations of the same shape drift, and the one that drifts is the one that
 * is not validated at runtime.
 */

/** The domain unions, expressed as Zod enums so they can validate input. */
export const roleSchema = z.enum(ROLES);
export const alertLevelSchema = z.enum(ALERT_LEVELS);
export const abcClassSchema = z.enum(ABC_CLASSES);
export const requestStatusSchema = z.enum(REQUEST_STATUSES);

/** Database identifier. Opaque to the client; never parsed or constructed. */
export const idSchema = z.string().min(1, "Identifiant requis").max(64);

/**
 * Cursor pagination.
 *
 * Offset pagination is deliberately not offered. The alert board is sorted by
 * severity over a table that changes while it is being read, and `OFFSET 40`
 * against a shifting result set silently skips and repeats rows. A cursor is
 * stable under concurrent writes, which is the normal condition here.
 */
export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().nullish(),
});

export type Pagination = z.infer<typeof paginationSchema>;

/** Free-text search, trimmed and length-capped before it reaches the database. */
export const searchSchema = z.string().trim().max(120, "Recherche trop longue").optional();

export const sortDirectionSchema = z.enum(["asc", "desc"]).default("asc");

/** Physical quantity of parts: whole units, never negative. */
export const quantitySchema = z
  .number()
  .int("La quantite doit etre un nombre entier d unites")
  .min(0, "La quantite ne peut pas etre negative");

/** A positive quantity, for the cases where zero makes no sense. */
export const positiveQuantitySchema = z
  .number()
  .int("La quantite doit etre un nombre entier d unites")
  .positive("La quantite doit etre superieure a zero");

/**
 * A justification. Required by the transitions the domain marks as such, so the
 * minimum length is a real rule: "no" is not a reason a storekeeper can act on.
 */
export const reasonSchema = z
  .string()
  .trim()
  .min(10, "Merci d indiquer un motif d au moins 10 caracteres")
  .max(1000, "Motif trop long");

/** Standard envelope for a paginated list. */
export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor: string | null;
  readonly totalCount: number;
}
