import { captureDailySnapshots } from "../modules/alert/alert.service";
import { runRecalculation } from "../modules/parameter/parameter.service";
import { notifyLateRequests } from "../modules/request/request.service";

/**
 * The scheduled maintenance pass (brief section 3.5).
 *
 * Everything the application has to do on a clock rather than in response to a
 * person. It exists as one named entry point, exported from the package, so the
 * route handler that triggers it stays a thin authorisation shell: the web layer
 * decides whether the caller may run the job, and this decides what the job is.
 * Without that split the composition would live in `apps/web`, where nothing
 * else about the domain lives and no service test can reach it.
 *
 * It takes no actor. A scheduled run has no user behind it, which is why
 * `ThresholdHistory.computedById` and `StockMovement.userId` are both nullable —
 * the schema anticipated this caller. Attributing the run to a service account
 * would put a person's name on a change nobody made.
 *
 * Idempotent by construction: recomputing a threshold that has not moved writes
 * the same figures and one more history row, which is a truthful record of the
 * run having happened. Nothing here depends on having run exactly once, so a
 * retry after a network failure is safe.
 */
export interface NightlyResult {
  readonly evaluated: number;
  readonly changed: number;
  readonly nowCritical: number;
  readonly reclassified: number;
  /** Articles whose alert state was recorded for today. */
  readonly snapshotted: number;
  /** Requests announced as late for the first time. */
  readonly lateNotified: number;
  readonly runAt: Date;
}

export async function runNightlyMaintenance(): Promise<NightlyResult> {
  // Unscoped on both axes, which is what lets it reclassify: a Pareto needs the
  // whole catalogue, and the job is one of the two callers entitled to it.
  const recalculation = await runRecalculation({
    siteId: null,
    abcClass: null,
    trigger: "SCHEDULED",
    actorId: null,
  });

  // After the recalculation, never before: the level recorded for today has to
  // be the one the new thresholds imply, not yesterday's.
  const snapshots = await captureDailySnapshots({ on: recalculation.runAt });

  // Lateness stays derived (ADR 0003) — this writes no status and stamps no
  // row. It only tells somebody, because an always-correct indicator is of no
  // use to a person who does not open the screen.
  const late = await notifyLateRequests({ asOf: recalculation.runAt });

  return {
    evaluated: recalculation.evaluated,
    changed: recalculation.changed,
    nowCritical: recalculation.nowCritical,
    reclassified: recalculation.reclassified,
    snapshotted: snapshots.written,
    lateNotified: late.notified,
    runAt: recalculation.runAt,
  };
}
