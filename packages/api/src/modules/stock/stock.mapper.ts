import type {
  StockByLocationItem,
  StockMovementListItem,
  StorageLocationOption,
} from "@leoni/contracts";

import type { StockLotRow, StockMovementRow } from "./stock.repository";

/**
 * Database rows to the DTOs the journal and the location view render.
 *
 * No `Decimal` crosses this boundary: quantities are `Int` by schema
 * convention, so unlike the article mapper this one only flattens relations.
 * It still exists as its own layer because the shape the screen reads must not
 * be the shape the query happens to return — a `select` widened for a new
 * column would otherwise change the API surface silently.
 */

export function toMovementListItem(row: StockMovementRow): StockMovementListItem {
  return {
    id: row.id,
    type: row.type,
    quantity: row.quantity,
    occurredAt: row.occurredAt,
    reference: row.reference,
    userName: row.user?.name ?? null,

    articleId: row.stockItem.article.id,
    articleReference: row.stockItem.article.reference,
    articleDesignation: row.stockItem.article.designation,

    siteCode: row.stockItem.site.code,
    // Null on a movement whose lot was later emptied and removed: the journal
    // outlives the shelf, and saying "unknown" is honest where inventing a
    // location would not be.
    locationCode: row.lot?.storageLocation.code ?? null,
  };
}

export function toStockByLocationItem(row: StockLotRow): StockByLocationItem {
  return {
    lotId: row.id,
    locationId: row.storageLocation.id,
    locationCode: row.storageLocation.code,
    articleId: row.stockItem.article.id,
    articleReference: row.stockItem.article.reference,
    articleDesignation: row.stockItem.article.designation,
    quantity: row.quantity,
    fifoDate: row.fifoDate,
  };
}

interface StorageLocationRow {
  id: string;
  code: string;
  description: string | null;
  siteId: string;
}

export function toStorageLocationOption(row: StorageLocationRow): StorageLocationOption {
  return { id: row.id, code: row.code, description: row.description, siteId: row.siteId };
}
