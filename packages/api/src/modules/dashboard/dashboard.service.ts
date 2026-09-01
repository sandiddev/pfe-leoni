import type {
  DashboardExport,
  DashboardExportInput,
  DashboardInput,
  DashboardSummary,
} from "@leoni/contracts";
import { ALERT_LEVELS } from "@leoni/core";

import type { Actor } from "../../context";
import { resolveSiteFilter } from "../../middlewares/site-scope";
import * as mapper from "./dashboard.mapper";
import type { DashboardRepository } from "./dashboard.repository";
import { dashboardRepository } from "./dashboard.repository";

/**
 * Business rules for the KPIs (brief section 6.5).
 *
 * Thin on purpose: the arithmetic is in the mapper, where it is tested against
 * fixed series, and the queries are in the repository. What is left here is the
 * window, the site scoping, and the fact that every figure on one screen comes
 * from one point in time — five KPIs fetched at five different moments would
 * quietly disagree with each other.
 */

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface ServiceParams<TInput> {
  readonly actor: Actor;
  readonly input: TInput;
  /** Injected by the tests. Defaults to the Prisma-backed repository. */
  readonly repository?: DashboardRepository;
}

export async function summary({
  actor,
  input,
  repository = dashboardRepository,
}: ServiceParams<DashboardInput>): Promise<DashboardSummary> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const generatedAt = new Date();
  const since = new Date(generatedAt.getTime() - input.days * MILLISECONDS_PER_DAY);

  const [trackedArticles, alertCounts, snapshots, statusCounts, openRequests, lateRequests, settled] =
    await Promise.all([
      repository.countTrackedArticles(siteId),
      repository.countByAlertLevel(siteId),
      repository.findSnapshots(siteId, since),
      repository.countRequestsByStatus(siteId, since),
      repository.countOpenRequests(siteId),
      repository.countLateRequests(siteId, generatedAt),
      repository.findSettledRequests(siteId, since),
    ]);

  const byLevel = new Map(alertCounts.map((entry) => [entry.level, entry.count]));

  return {
    windowDays: input.days,
    generatedAt,
    trackedArticles,
    // Every level listed, so a tile does not disappear when the news is good.
    alertDistribution: ALERT_LEVELS.map((level) => ({
      level,
      count: byLevel.get(level) ?? 0,
    })),
    openRequests,
    lateRequests,
    serviceLevel: mapper.toServiceLevel(settled),
    leadTime: mapper.toLeadTime(settled),
    stockOutHistory: mapper.toStockOutHistory(snapshots),
    requestsByStatus: mapper.toRequestsByStatus(statusCounts),
  };
}

/**
 * The same figures as a spreadsheet.
 *
 * Recomputed through `summary` rather than from a second set of queries, so the
 * export and the screen cannot disagree about a number the jury is reading off
 * both.
 */
export async function exportCsv({
  actor,
  input,
  repository = dashboardRepository,
}: ServiceParams<DashboardExportInput>): Promise<DashboardExport> {
  const data = await summary({ actor, input, repository });
  const stamp = data.generatedAt.toISOString().slice(0, 10);

  return {
    fileName: `indicateurs-reapprovisionnement-${stamp}.csv`,
    content: mapper.toCsv(data),
  };
}
