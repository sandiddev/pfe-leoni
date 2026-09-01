import type { LocationItem, SiteItem } from "@leoni/contracts";

import type { LocationRow, SiteRow } from "./referential.repository";

/**
 * Rows to the DTOs the administration screen renders.
 *
 * Both DTOs carry a count the screen needs in order to explain a refusal
 * *before* the user tries: a shelf showing "3 lots" is a shelf whose delete
 * button can say why it is disabled, rather than failing on click.
 */

export function toSiteItem(row: SiteRow): SiteItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    locationCount: row._count.storageLocations,
    // Both directions, because a site is the supplier of some requests and the
    // consumer of others, and either one pins its type.
    requestCount: row._count.requestsFrom + row._count.requestsTo,
  };
}

export function toLocationItem(row: LocationRow): LocationItem {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    siteId: row.siteId,
    siteCode: row.site.code,
    lotCount: row.lots.length,
    totalQuantity: row.lots.reduce((sum, lot) => sum + lot.quantity, 0),
  };
}
