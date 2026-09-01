import type { Metadata } from "next";

import { PageHeader } from "@leoni/ui";
import { NewRequestForm } from "~/features/request/new-request-form";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Nouvelle demande" };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Raising a request.
 *
 * Arrived at from the alert board with the selected articles in the query
 * string, so the lines are prefilled with the quantity the domain proposed. A
 * storekeeper who has to retype what the board just computed will stop reading
 * the board.
 */
export default async function NouvelleDemandePage({ searchParams }: PageProps) {
  const parameters = await searchParams;
  const raw = parameters["articles"];
  const requested = (typeof raw === "string" ? raw.split(",") : []).filter(
    (value) => value !== "",
  );

  // The suggestion comes from the same board the selection was made on, so the
  // figures on this screen and the one before it cannot disagree.
  const board = await api.alert.board({ limit: 100, includeNormal: true });
  const prefill = board.items.filter((item) => requested.includes(item.articleId));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Nouvelle demande de reapprovisionnement"
        description="Les quantites proposees sont arrondies au multiple de VPE superieur. Vous pouvez les ajuster avant de soumettre."
      />

      <NewRequestForm prefill={prefill} catalogue={board.items} />
    </div>
  );
}
