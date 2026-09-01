import type { Metadata } from "next";
import Link from "next/link";

import { can } from "@leoni/core";
import { Button, PageHeader } from "@leoni/ui";
import { RequestList } from "~/features/request/request-list";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Demandes" };

/**
 * The replenishment requests.
 *
 * The list a warehouse manager scans in the morning: what is waiting on them,
 * what is late, and what LTN4 still owes. Lateness is an indicator here, never
 * a status — a late request keeps showing where it actually is.
 */
export default async function DemandesPage() {
  const [actor, page] = await Promise.all([
    api.session.me(),
    api.request.list({ limit: 25, onlyMine: false, onlyLate: false }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Demandes de reapprovisionnement"
        description="Le fil complet de chaque demande, de la saisie a la cloture."
        actions={
          can(actor.role, "request:create") ? (
            <Button asChild>
              <Link href="/demandes/nouvelle">Nouvelle demande</Link>
            </Button>
          ) : undefined
        }
      />

      <RequestList initialItems={page.items} totalCount={page.totalCount} />
    </div>
  );
}
