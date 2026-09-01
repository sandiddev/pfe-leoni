import type { Metadata } from "next";

import { PageHeader } from "@leoni/ui";
import { NotificationCentre } from "~/features/notification/notification-centre";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Notifications" };

/**
 * The notification centre.
 *
 * Each row was written in the same transaction as the change it announces, so
 * a notification here is a change that actually happened — not a message that
 * outlived a rolled-back approval.
 */
export default async function NotificationsPage() {
  const page = await api.notification.list({ limit: 50, onlyUnread: false });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Les evenements du reapprovisionnement qui vous concernent, du plus recent au plus ancien."
      />

      <NotificationCentre initialItems={page.items} totalCount={page.totalCount} />
    </div>
  );
}
