import { CircleAlert, OctagonX, Package, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader, StatCard } from "@leoni/ui";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Tableau de bord" };

/**
 * Landing screen after sign-in.
 *
 * A first pass: it counts articles by alert level using the article list the
 * article module already exposes. The full KPI set of section 6.5 — taux de
 * service, delai reel contre theorique, taux de rupture dans le temps — belongs
 * in a dedicated `dashboard` module reading `StockAlertSnapshot`, which is why
 * that table is seeded with ninety days of history.
 */
export default async function DashboardPage() {
  const [all, rupture, critical, warning] = await Promise.all([
    api.article.list({
      limit: 1,
      sortBy: "reference",
      sortDirection: "asc",
      onlyReplenishable: false,
      includeInactive: false,
    }),
    api.article.list({
      limit: 1,
      sortBy: "reference",
      sortDirection: "asc",
      onlyReplenishable: false,
      includeInactive: false,
      alertLevel: "RUPTURE",
    }),
    api.article.list({
      limit: 1,
      sortBy: "reference",
      sortDirection: "asc",
      onlyReplenishable: false,
      includeInactive: false,
      alertLevel: "CRITICAL",
    }),
    api.article.list({
      limit: 1,
      sortBy: "reference",
      sortDirection: "asc",
      onlyReplenishable: false,
      includeInactive: false,
      alertLevel: "WARNING",
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord"
        description="Situation des stocks du site et articles necessitant un reapprovisionnement."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Articles suivis" value={all.totalCount} icon={Package} />
        <StatCard
          label="En rupture"
          value={rupture.totalCount}
          icon={OctagonX}
          tone="rupture"
          hint="Stock nul : ligne de production exposee"
        />
        <StatCard
          label="Critiques"
          value={critical.totalCount}
          icon={CircleAlert}
          tone="critical"
          hint="Au niveau ou sous le seuil mini"
        />
        <StatCard
          label="En alerte"
          value={warning.totalCount}
          icon={TriangleAlert}
          tone="warning"
          hint="Approche du seuil de declenchement"
        />
      </div>
    </div>
  );
}
