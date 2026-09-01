import type { Metadata } from "next";

import { can } from "@leoni/core";
import { PageHeader } from "@leoni/ui";
import { AlertBoard } from "~/features/alert/alert-board";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Alertes" };

/**
 * The alert board.
 *
 * The screen the storekeeper starts the day on: what is at risk, most severe
 * first, with the quantity to order already computed. Selecting rows here is
 * how a replenishment request gets raised, which is the whole point of
 * replacing the email thread.
 */
export default async function AlertesPage() {
  const [actor, page, counts] = await Promise.all([
    api.session.me(),
    api.alert.board({ limit: 50, includeNormal: false }),
    api.alert.summary({}),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alertes"
        description={`${String(counts.actionable)} article(s) au niveau ou sous le seuil mini. Les quantites proposees sont arrondies au multiple de VPE superieur.`}
      />

      <AlertBoard
        initialItems={page.items}
        totalCount={page.totalCount}
        summary={counts}
        canCreateRequest={can(actor.role, "request:create")}
      />
    </div>
  );
}
