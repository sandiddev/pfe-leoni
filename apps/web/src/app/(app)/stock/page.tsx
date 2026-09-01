import type { Metadata } from "next";

import { can } from "@leoni/core";
import { PageHeader } from "@leoni/ui";
import { StockJournal } from "~/features/stock/stock-journal";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Stock et mouvements" };

/**
 * The stock journal.
 *
 * Every change to a stock level is one row here, which is what makes a figure
 * on the alert board explainable. The first page and the destination list are
 * fetched on the server so the screen arrives populated; the movement form and
 * the filters take over in the browser.
 */
export default async function StockPage() {
  const [actor, page, locations] = await Promise.all([
    api.session.me(),
    api.stock.list({ limit: 25 }),
    api.stock.locations({}),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock et mouvements"
        description="Journal des entrees, sorties et transferts. Chaque ligne explique un niveau de stock."
      />

      <StockJournal
        initialItems={page.items}
        totalCount={page.totalCount}
        locations={locations}
        canMove={can(actor.role, "stock:move")}
        canAdjust={can(actor.role, "stock:adjust")}
      />
    </div>
  );
}
