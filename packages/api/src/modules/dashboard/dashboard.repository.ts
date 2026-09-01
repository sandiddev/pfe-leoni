import type { AlertLevel, RequestStatus } from "@leoni/core";
import { db } from "@leoni/db";

/**
 * Persistence for the KPIs.
 *
 * Read-only by construction: a dashboard that writes is a dashboard that can
 * corrupt the thing it reports on. Every query below is an aggregate over a
 * window, because the questions in section 6.5 are all "how did this move",
 * not "what is it now".
 */

export async function countTrackedArticles(siteId: string | null): Promise<number> {
  return db.stockItem.count({
    where: { article: { isActive: true }, ...(siteId === null ? {} : { siteId }) },
  });
}

export async function countByAlertLevel(
  siteId: string | null,
): Promise<readonly { level: AlertLevel; count: number }[]> {
  const grouped = await db.stockItem.groupBy({
    by: ["alertLevel"],
    where: { article: { isActive: true }, ...(siteId === null ? {} : { siteId }) },
    _count: { _all: true },
  });

  return grouped.map((group) => ({ level: group.alertLevel, count: group._count._all }));
}

/** The alert history, which is the only thing that can answer a question about the past. */
export async function findSnapshots(siteId: string | null, since: Date) {
  return db.stockAlertSnapshot.findMany({
    where: {
      snapshotDate: { gte: since },
      ...(siteId === null ? {} : { stockItem: { siteId } }),
    },
    select: { snapshotDate: true, level: true },
    orderBy: { snapshotDate: "asc" },
  });
}

function siteFilter(siteId: string | null) {
  return siteId === null ? {} : { OR: [{ fromSiteId: siteId }, { toSiteId: siteId }] };
}

export async function countRequestsByStatus(
  siteId: string | null,
  since: Date,
): Promise<readonly { status: RequestStatus; count: number }[]> {
  const grouped = await db.replenishmentRequest.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since }, ...siteFilter(siteId) },
    _count: { _all: true },
  });

  return grouped.map((group) => ({ status: group.status, count: group._count._all }));
}

export async function countOpenRequests(siteId: string | null): Promise<number> {
  return db.replenishmentRequest.count({
    where: { status: { notIn: ["CLOSED", "REJECTED", "CANCELLED"] }, ...siteFilter(siteId) },
  });
}

/**
 * Requests already past their commitment.
 *
 * Narrowed in SQL to the rows that *could* be late; whether one actually is
 * remains `assessLateness`'s decision, and terminal statuses are excluded here
 * for the same reason it excludes them — a cancelled request was never going to
 * arrive.
 */
export async function countLateRequests(siteId: string | null, now: Date): Promise<number> {
  return db.replenishmentRequest.count({
    where: {
      expectedDeliveryAt: { lt: now },
      status: { notIn: ["CLOSED", "REJECTED", "CANCELLED"] },
      ...siteFilter(siteId),
    },
  });
}

/**
 * Every settled request in the window, with the figures the service level and
 * the lead time are computed from.
 *
 * One query rather than three aggregates: the same rows answer all of them, and
 * the arithmetic belongs in the service where it can be tested.
 */
export async function findSettledRequests(siteId: string | null, since: Date) {
  return db.replenishmentRequest.findMany({
    where: {
      status: { in: ["RECEIVED", "CLOSED"] },
      receivedAt: { gte: since },
      ...siteFilter(siteId),
    },
    select: {
      createdAt: true,
      submittedAt: true,
      approvedAt: true,
      sentAt: true,
      receivedAt: true,
      expectedDeliveryAt: true,
      lines: {
        select: {
          requestedQuantity: true,
          approvedQuantity: true,
          receivedQuantity: true,
          article: { select: { leadTimeDays: true } },
        },
      },
    },
  });
}

export const dashboardRepository = {
  countTrackedArticles,
  countByAlertLevel,
  findSnapshots,
  countRequestsByStatus,
  countOpenRequests,
  countLateRequests,
  findSettledRequests,
};

export type DashboardRepository = typeof dashboardRepository;
