import type { Metadata } from "next";

import { can } from "@leoni/core";
import { PageHeader } from "@leoni/ui";
import { AdminPanel } from "~/features/admin/admin-panel";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Administration" };

/**
 * Users, roles and the audit log.
 *
 * Accounts are deactivated rather than deleted, so the trail keeps a resolvable
 * author: a comment, a movement or an approval from a deleted user would become
 * an event nobody performed.
 */
export default async function AdministrationPage() {
  const actor = await api.session.me();
  const canReadAudit = can(actor.role, "audit:read");

  const [users, sites, referentialSites, locations, audit] = await Promise.all([
    api.admin.users.list({ includeInactive: true }),
    api.admin.users.sites({}),
    api.referential.sites.list({}),
    api.referential.locations.list({}),
    canReadAudit ? api.admin.audit.list({ limit: 25 }) : null,
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Administration"
        description="Roles, sites et journal des modifications. Un compte se desactive, il ne se supprime pas."
      />

      <AdminPanel
        users={users}
        sites={sites}
        referentialSites={referentialSites}
        locations={locations}
        initialAudit={audit?.items ?? []}
        auditTotalCount={audit?.totalCount ?? 0}
        currentUserId={actor.userId}
        canEditUsers={can(actor.role, "user:write")}
        canEditLocations={can(actor.role, "stock:adjust")}
        canReadAudit={canReadAudit}
      />
    </div>
  );
}
