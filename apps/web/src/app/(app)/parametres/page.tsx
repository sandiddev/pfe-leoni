import type { Metadata } from "next";

import { can } from "@leoni/core";
import { PageHeader } from "@leoni/ui";
import { ParameterPanel } from "~/features/parameter/parameter-panel";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Parametres" };

/**
 * The tuning parameters (brief section 3.4).
 *
 * Every number a threshold is computed from is editable here rather than in
 * source. That is the requirement: widening the class A safety margin is a form
 * submission, not a redeployment.
 */
export default async function ParametresPage() {
  const [actor, parameters, history] = await Promise.all([
    api.session.me(),
    api.parameter.list({}),
    api.parameter.history({ limit: 30 }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Parametres de reapprovisionnement"
        description="Seuil mini = consommation moyenne x (delai + jours de securite). Seuil maxi = mini + consommation x couverture additionnelle."
      />

      <ParameterPanel
        parameters={parameters}
        history={history}
        canEdit={can(actor.role, "parameter:write")}
        canRecalculate={can(actor.role, "threshold:recalculate")}
      />
    </div>
  );
}
