import type {
  AlertBoardInput,
  AlertBoardItem,
  AlertSummary,
  AlertSummaryInput,
  Page,
} from "@leoni/contracts";
import type { AbcClass, AlertLevel, ClassParameters } from "@leoni/core";
import {
  ABC_CLASSES,
  compareAlertSeverityDesc,
  daysOfCoverage,
  defaultParametersForClass,
  SHORTAGE_LEVELS,
} from "@leoni/core";

import type { Actor } from "../../context";
import { resolveSiteFilter } from "../../middlewares/site-scope";
import * as mapper from "./alert.mapper";
import type { AlertRepository, AlertRow } from "./alert.repository";
import { alertRepository } from "./alert.repository";

/**
 * Business rules for the alert board.
 *
 * The board is thin by construction — the severity is already a column, and the
 * arithmetic is already in `@leoni/core`. What this file adds is the ordering a
 * storekeeper actually needs (most severe first, then soonest to run out) and
 * the suggested quantity that makes the board actionable rather than
 * informational.
 */

interface ServiceParams<TInput> {
  readonly actor: Actor;
  readonly input: TInput;
  /** Injected by the tests. Defaults to the Prisma-backed repository. */
  readonly repository?: AlertRepository;
}

/**
 * The tuning parameters for all three classes, in one round trip.
 *
 * Looking them up per row would issue one query per article on a full board.
 * There are exactly three classes.
 */
async function loadParametersByClass(
  repository: AlertRepository,
): Promise<ReadonlyMap<AbcClass, ClassParameters>> {
  const rows = await Promise.all(
    ABC_CLASSES.map(async (abcClass) => ({
      abcClass,
      row: await repository.findParameterForClass(abcClass),
    })),
  );

  return new Map(
    rows.map(({ abcClass, row }) => [
      abcClass,
      row === null
        ? defaultParametersForClass(abcClass)
        : {
            safetyDays: row.safetyDays.toNumber(),
            extraCoverageDays: row.extraCoverageDays.toNumber(),
            averagingWindowDays: row.averagingWindowDays,
            warningMarginRatio: row.warningMarginRatio.toNumber(),
          },
    ]),
  );
}

/**
 * The parameters that actually govern one row.
 *
 * An article-level override beats its class default, exactly as in the article
 * service. Both call sites matter: a board that proposed a class-default
 * quantity while the article detail page showed an overridden one would be two
 * answers to the same question.
 */
function parametersFor(
  byClass: ReadonlyMap<AbcClass, ClassParameters>,
  row: AlertRow,
): ClassParameters {
  const override = row.article.parameter;

  if (override !== null) {
    return {
      safetyDays: override.safetyDays.toNumber(),
      extraCoverageDays: override.extraCoverageDays.toNumber(),
      averagingWindowDays: override.averagingWindowDays,
      warningMarginRatio: override.warningMarginRatio.toNumber(),
    };
  }

  const abcClass = row.article.abcClass;
  return byClass.get(abcClass) ?? defaultParametersForClass(abcClass);
}

/**
 * Most severe first, then the one that runs out soonest.
 *
 * Coverage is not a column, so the database can only approximate this. Sorting
 * the page here makes the displayed order exact — and an article with no
 * measured consumption sorts last within its severity rather than as zero days,
 * which would put a reference nobody consumes at the top of the board.
 */
function bySeverityThenUrgency(left: AlertBoardItem, right: AlertBoardItem): number {
  const bySeverity = compareAlertSeverityDesc(left.alertLevel, right.alertLevel);
  if (bySeverity !== 0) return bySeverity;

  const leftCoverage = left.coverageDays ?? Number.POSITIVE_INFINITY;
  const rightCoverage = right.coverageDays ?? Number.POSITIVE_INFINITY;
  if (leftCoverage !== rightCoverage) return leftCoverage - rightCoverage;

  return left.reference.localeCompare(right.reference);
}

export async function board({
  actor,
  input,
  repository = alertRepository,
}: ServiceParams<AlertBoardInput>): Promise<Page<AlertBoardItem>> {
  const siteId = resolveSiteFilter(actor, input.siteId);

  const [{ rows, totalCount }, parametersByClass] = await Promise.all([
    repository.findBoard({ input, siteId }),
    loadParametersByClass(repository),
  ]);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  const items = page.map((row) => {
    const parameters = parametersFor(parametersByClass, row);
    return mapper.toBoardItem({
      row,
      safetyDays: parameters.safetyDays,
      extraCoverageDays: parameters.extraCoverageDays,
      warningMarginRatio: parameters.warningMarginRatio,
    });
  });

  return {
    // A page-local correction, like the article list's coverage sort. The
    // screen documents that urgency ordering is within-page.
    items: [...items].sort(bySeverityThenUrgency),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    totalCount,
  };
}


export async function summary({
  actor,
  input,
  repository = alertRepository,
}: ServiceParams<AlertSummaryInput>): Promise<AlertSummary> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const grouped = await repository.countByLevel(siteId);

  const counts = new Map(grouped.map((group) => [group.alertLevel, group.count]));

  // Written out rather than folded from `ALERT_LEVELS`, because `Record<AlertLevel, number>`
  // then makes the compiler — not a test — refuse a new level that nobody counted.
  // A level with no rows must read as 0: a tile that disappears when the news
  // is good is a bug, not a saving.
  const byLevel: Readonly<Record<AlertLevel, number>> = {
    NORMAL: counts.get("NORMAL") ?? 0,
    WARNING: counts.get("WARNING") ?? 0,
    CRITICAL: counts.get("CRITICAL") ?? 0,
    RUPTURE: counts.get("RUPTURE") ?? 0,
  };

  // `SHORTAGE_LEVELS` from the domain, not a second list here: "the reorder
  // point is reached" is one definition, and it also decides who gets notified.
  const actionable = SHORTAGE_LEVELS.reduce((sum, level) => sum + (counts.get(level) ?? 0), 0);

  return { ...byLevel, actionable };
}

/**
 * Records today's alert state for every tracked article (brief section 6.5).
 *
 * The rupture-rate trend on the dashboard is read from `StockAlertSnapshot`,
 * and nothing in the running application used to write it — only the seed did,
 * so the curve was frozen demo data that stopped moving the day the database
 * was created.
 *
 * A daily row per article rather than a running total, because every KPI in
 * section 6.5 is a question about *change*: "was the rupture rate better last
 * month" cannot be answered from current state at any price.
 *
 * Called by the nightly job after the recalculation, so the level it records is
 * the one the new thresholds imply rather than yesterday's.
 */
export async function captureDailySnapshots({
  on,
  repository = alertRepository,
}: {
  /** The day being recorded. Passed in: the domain never reads the clock. */
  readonly on: Date;
  readonly repository?: AlertRepository;
}): Promise<{ readonly subjects: number; readonly written: number }> {
  const subjects = await repository.findSnapshotSubjects();

  // Midnight UTC: the column is a `@db.Date`, and the unique index that makes
  // this idempotent is on (stockItemId, snapshotDate). A timestamp carrying the
  // hour the job happened to run would defeat it.
  const snapshotDate = new Date(
    Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()),
  );

  const written = await repository.appendAlertSnapshots(
    subjects.map((subject) => ({
      stockItemId: subject.id,
      // The stored level, not a recomputed one: it was written by the domain in
      // the same transaction as the change that caused it, and recomputing here
      // would let the snapshot disagree with the board it summarises.
      level: subject.alertLevel,
      currentStock: subject.currentStock,
      minThreshold: subject.minThreshold.toNumber(),
      coverageDays: daysOfCoverage(
        subject.currentStock,
        subject.averageDailyConsumption.toNumber(),
      ),
      snapshotDate,
    })),
  );

  return { subjects: subjects.length, written };
}
