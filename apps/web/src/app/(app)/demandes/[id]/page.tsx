import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { can } from "@leoni/core";
import { PageHeader } from "@leoni/ui";
import { RequestDetailView } from "~/features/request/request-detail-view";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Demande" };

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

/**
 * One request, end to end.
 *
 * The action bar is built from `availableActions`, which the server derives
 * from the domain transition table for this role and this exact status. A
 * button that appears here is a button the server will accept.
 */
export default async function DemandeDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [actor, request] = await Promise.all([
    api.session.me(),
    api.request.byId({ requestId: id }).catch(() => null),
  ]);

  if (request === null) notFound();

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Demande ${request.code}`}
        description={`${request.fromSiteCode} vers ${request.toSiteCode} — creee par ${request.createdByName}`}
      />

      <RequestDetailView request={request} canComment={can(actor.role, "request:comment")} />
    </div>
  );
}
