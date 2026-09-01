import { CircleAlert, ClipboardList, Clock, OctagonX, Package, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";

import { ALERT_LEVEL_LABELS_FR } from "@leoni/contracts";
import { can } from "@leoni/core";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  formatDecimal,
  formatQuantity,
  PageHeader,
  StatCard,
} from "@leoni/ui";
import { ExportButton } from "~/features/dashboard/export-button";
import { StatusBars } from "~/features/dashboard/status-bars";
import { TrendChart } from "~/features/dashboard/trend-chart";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Tableau de bord" };

const WINDOW_DAYS = 90;

/** A rate that cannot be measured says so, rather than showing a confident 0. */
function percent(value: number | null): string {
  return value === null ? "—" : `${formatDecimal(value)} %`;
}

function days(value: number | null): string {
  return value === null ? "—" : `${formatDecimal(value)} j`;
}

/**
 * The KPI dashboard (brief section 6.5).
 *
 * Every figure below is a question about the past, which is what
 * `StockAlertSnapshot` exists for: alert levels are recomputed on read from the
 * current stock, so the present cannot say how many articles were at risk in
 * February.
 */
export default async function DashboardPage() {
  const [actor, data] = await Promise.all([
    api.session.me(),
    api.dashboard.summary({ days: WINDOW_DAYS }),
  ]);

  const level = (name: "RUPTURE" | "CRITICAL" | "WARNING") =>
    data.alertDistribution.find((entry) => entry.level === name)?.count ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord"
        description={`Situation des stocks et performance du reapprovisionnement sur ${String(WINDOW_DAYS)} jours.`}
        actions={can(actor.role, "report:export") ? <ExportButton days={WINDOW_DAYS} /> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Articles suivis" value={data.trackedArticles} icon={Package} />
        <StatCard
          label={ALERT_LEVEL_LABELS_FR.RUPTURE}
          value={level("RUPTURE")}
          icon={OctagonX}
          tone="rupture"
          hint="Stock nul : ligne de production exposee"
        />
        <StatCard
          label={ALERT_LEVEL_LABELS_FR.CRITICAL}
          value={level("CRITICAL")}
          icon={CircleAlert}
          tone="critical"
          hint="Au niveau ou sous le seuil mini"
        />
        <StatCard
          label={ALERT_LEVEL_LABELS_FR.WARNING}
          value={level("WARNING")}
          icon={TriangleAlert}
          tone="warning"
          hint="Approche du seuil de declenchement"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Demandes en cours"
          value={data.openRequests}
          icon={ClipboardList}
          hint="Non cloturees, tous statuts confondus"
        />
        <StatCard
          label="Demandes en retard"
          value={data.lateRequests}
          icon={Clock}
          tone={data.lateRequests > 0 ? "critical" : "normal"}
          hint="Au-dela de la date de livraison annoncee"
        />
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Taux de service</CardDescription>
            <CardTitle className="tabular text-2xl">
              {percent(data.serviceLevel.rate)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-foreground-muted">
            {formatQuantity(data.serviceLevel.fullyServed)} sur{" "}
            {formatQuantity(data.serviceLevel.closedRequests)} demandes livrees completes ·{" "}
            {percent(data.serviceLevel.onTimeRate)} a l heure
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Delai reel contre theorique</CardDescription>
            <CardTitle className="tabular text-2xl">
              {days(data.leadTime.averageRealDays)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-foreground-muted">
            Theorique {days(data.leadTime.averageTheoreticalDays)} · validation{" "}
            {days(data.leadTime.averageApprovalDays)} · mesure sur{" "}
            {formatQuantity(data.leadTime.measuredRequests)} demande(s)
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Evolution du taux de rupture</CardTitle>
            <CardDescription>
              Part des articles suivis a stock nul, jour par jour. Calculee sur le nombre d articles
              photographies ce jour-la, pas sur le catalogue actuel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart points={data.stockOutHistory} label="Taux de rupture" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Demandes par statut</CardTitle>
            <CardDescription>
              Sur les {String(WINDOW_DAYS)} derniers jours. Le retard n est pas un statut : il est
              indique a cote de l etat reel de la demande.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StatusBars counts={data.requestsByStatus} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
