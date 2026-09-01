import type {
  ArticleParameterInput,
  ArticleParameters,
  ParameterHistoryInput,
  ParameterItem,
  RecalculateInput,
  RecalculationHistoryItem,
  RecalculationResult,
  UpdateParameterInput,
  UpsertArticleParameterInput,
} from "@leoni/contracts";
import type { AbcClass, ClassParameters, RecalculationTrigger } from "@leoni/core";
import {
  ABC_CLASSES,
  BusinessRuleError,
  classifyAbc,
  computeThresholds,
  defaultParametersForClass,
  NotFoundError,
  resolveAlertLevel,
  rollingAverageDailyConsumption,
} from "@leoni/core";

import type { Actor } from "../../context";
import { resolveSiteFilter } from "../../middlewares/site-scope";
import type { AuditPayload } from "../../shared/audit";
import * as mapper from "./parameter.mapper";
import type { ParameterRepository, ThresholdWrite } from "./parameter.repository";
import { parameterRepository } from "./parameter.repository";

/**
 * Business rules for the tuning parameters and the threshold recalculation.
 *
 * Nothing in this file computes a threshold: `computeThresholds` does, from
 * inputs this service gathers. What lives here is which inputs apply to which
 * article, what a run counts as changed, and the fact that every recomputed
 * figure leaves a row explaining the parameters it came from.
 */

interface ServiceParams<TInput> {
  readonly actor: Actor;
  readonly input: TInput;
  /** Injected by the tests. Defaults to the Prisma-backed repository. */
  readonly repository?: ParameterRepository;
}

export async function list({
  repository = parameterRepository,
}: {
  readonly actor: Actor;
  readonly repository?: ParameterRepository;
}): Promise<readonly ParameterItem[]> {
  const rows = await repository.findParameters();
  const byClass = new Map(rows.map((row) => [row.abcClass, row]));

  // Every class is listed, whether or not a row exists. A class missing from
  // the screen is a class running on defaults nobody can see.
  return ABC_CLASSES.map((abcClass) => {
    const row = byClass.get(abcClass);
    return row === undefined
      ? mapper.toDefaultParameterItem(abcClass)
      : mapper.toParameterItem(row, abcClass);
  });
}

function auditPayload(parameters: ClassParameters): AuditPayload {
  return {
    safetyDays: parameters.safetyDays,
    extraCoverageDays: parameters.extraCoverageDays,
    averagingWindowDays: parameters.averagingWindowDays,
    warningMarginRatio: parameters.warningMarginRatio,
  };
}

/**
 * Changes a class's tuning parameters.
 *
 * The change is audited with both sides, because every threshold in the
 * application derives from these four numbers: "who widened the class A safety
 * margin, and from what" has to be answerable months later.
 *
 * The class's thresholds are then recomputed, with the `PARAMETER_CHANGE`
 * trigger. Without it the edit had no observable effect: `minThreshold` and
 * `alertLevel` are stored columns computed from these numbers, so every article
 * in the class kept its old figures — and its old alert level — until somebody
 * remembered to press Recalculer. A parameter screen whose changes do nothing
 * until a second, unrelated action is a screen that lies about what it does.
 *
 * The recalculation is scoped to the edited class, so an edit to class C does
 * not re-derive class A. It is not inside the audit transaction: that would
 * hold a lock on every article in the class for the length of the run, and the
 * two facts are independently meaningful — the audit row says what was changed,
 * the history rows say what it did.
 */
export async function update({
  actor,
  input,
  repository = parameterRepository,
}: ServiceParams<UpdateParameterInput>): Promise<{ abcClass: AbcClass }> {
  const existing = await repository.findParameters();
  const before = existing.find((row) => row.abcClass === input.abcClass);

  const data = {
    safetyDays: input.safetyDays,
    extraCoverageDays: input.extraCoverageDays,
    averagingWindowDays: input.averagingWindowDays,
    warningMarginRatio: input.warningMarginRatio,
  };

  await repository.upsertWithAudit({
    abcClass: input.abcClass,
    data,
    audit: {
      entity: "ReplenishmentParameter",
      entityId: input.abcClass,
      action: before === undefined ? "CREATE" : "UPDATE",
      before:
        before === undefined
          ? null
          : auditPayload({
              safetyDays: before.safetyDays.toNumber(),
              extraCoverageDays: before.extraCoverageDays.toNumber(),
              averagingWindowDays: before.averagingWindowDays,
              warningMarginRatio: before.warningMarginRatio.toNumber(),
            }),
      after: auditPayload(data),
      actorId: actor.userId,
    },
  });

  await runRecalculation({
    siteId: resolveSiteFilter(actor, undefined),
    abcClass: input.abcClass,
    trigger: "PARAMETER_CHANGE",
    actorId: actor.userId,
    repository,
  });

  return { abcClass: input.abcClass };
}

/** The parameters in force per class, defaults included, in one round trip. */
async function parametersByClass(
  repository: ParameterRepository,
): Promise<ReadonlyMap<AbcClass, ClassParameters>> {
  const rows = await repository.findParameters();
  const byClass = new Map(rows.map((row) => [row.abcClass, row]));

  return new Map(
    ABC_CLASSES.map((abcClass) => {
      const row = byClass.get(abcClass);
      return [
        abcClass,
        row === undefined ? defaultParametersForClass(abcClass) : toClassParameters(row),
      ];
    }),
  );
}

interface ConsumptionSample {
  readonly stockItemId: string;
  readonly quantity: number;
  readonly occurredAt: Date;
}

/** Outbound movements grouped per stock item, so the average is one pass. */
function groupSamples(
  samples: readonly ConsumptionSample[],
): ReadonlyMap<string, readonly { occurredAt: Date; quantity: number }[]> {
  const byStockItem = new Map<string, { occurredAt: Date; quantity: number }[]>();

  for (const sample of samples) {
    const existing = byStockItem.get(sample.stockItemId) ?? [];
    existing.push({ occurredAt: sample.occurredAt, quantity: sample.quantity });
    byStockItem.set(sample.stockItemId, existing);
  }

  return byStockItem;
}

type RecalculationTarget = Awaited<
  ReturnType<ParameterRepository["findRecalculationTargets"]>
>[number];

/** A parameter row as Prisma returns it, with its Decimal columns. */
interface StoredParameters {
  readonly safetyDays: { toNumber: () => number };
  readonly extraCoverageDays: { toNumber: () => number };
  readonly averagingWindowDays: number;
  readonly warningMarginRatio: { toNumber: () => number };
}

function toClassParameters(row: StoredParameters): ClassParameters {
  return {
    safetyDays: row.safetyDays.toNumber(),
    extraCoverageDays: row.extraCoverageDays.toNumber(),
    averagingWindowDays: row.averagingWindowDays,
    warningMarginRatio: row.warningMarginRatio.toNumber(),
  };
}

/**
 * The parameters that actually apply to one article.
 *
 * An article-level row beats its class default — that is the point of the
 * override (brief section 3.4): a single critical reference can be treated more
 * conservatively than the rest of its class without moving the whole class.
 */
function effectiveParameters(
  target: RecalculationTarget,
  byClass: ReadonlyMap<AbcClass, ClassParameters>,
): ClassParameters {
  const override = target.article.parameter;
  if (override !== null) return toClassParameters(override);

  return byClass.get(target.article.abcClass) ?? defaultParametersForClass(target.article.abcClass);
}

interface ComputeInputs {
  readonly target: RecalculationTarget;
  readonly parameters: ClassParameters;
  readonly samples: readonly { occurredAt: Date; quantity: number }[];
  readonly context: {
    readonly now: Date;
    readonly trigger: RecalculationTrigger;
    /** Null when the scheduled job ran it rather than a person. */
    readonly actorId: string | null;
  };
}

/**
 * One stock item's new figures.
 *
 * The parameters are snapshotted into the history row rather than referenced,
 * because the row they came from will itself change: a foreign key would make
 * the history lie the moment somebody edits a default.
 */
function computeWrite(inputs: ComputeInputs): ThresholdWrite {
  const { target, parameters, samples, context } = inputs;

  const averageDailyConsumption = rollingAverageDailyConsumption({
    samples,
    windowDays: parameters.averagingWindowDays,
    now: context.now,
  });

  const thresholds = computeThresholds({
    averageDailyConsumption,
    leadTimeDays: target.article.leadTimeDays,
    safetyDays: parameters.safetyDays,
    extraCoverageDays: parameters.extraCoverageDays,
  });

  return {
    stockItemId: target.id,
    averageDailyConsumption,
    minThreshold: thresholds.min,
    maxThreshold: thresholds.max,
    safetyStock: thresholds.safetyStock,
    alertLevel: resolveAlertLevel({
      currentStock: target.currentStock,
      min: thresholds.min,
      warningMarginRatio: parameters.warningMarginRatio,
    }),
    parametersSnapshot: { ...parameters, leadTimeDays: target.article.leadTimeDays },
    trigger: context.trigger,
    computedById: context.actorId,
    computedAt: context.now,
  };
}

/** Whether the run actually moved anything, so the screen can report honestly. */
function hasChanged(target: RecalculationTarget, write: ThresholdWrite): boolean {
  return (
    target.minThreshold.toNumber() !== write.minThreshold ||
    target.maxThreshold.toNumber() !== write.maxThreshold ||
    target.safetyStock.toNumber() !== write.safetyStock ||
    target.alertLevel !== write.alertLevel
  );
}

/** The longest window any class can ask for, so one query serves them all. */
const MAX_WINDOW_DAYS = 90;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How a recalculation run was reached.
 *
 * The trigger is a parameter rather than a constant because the same pass is
 * the answer to four different questions — a person pressing Recalculer, the
 * nightly job, a parameter edit taking effect, and a catalogue import. Each
 * writes its own trigger into `ThresholdHistory`, so "why did this threshold
 * move" is answerable from the row itself.
 */
export interface RecalculationRun {
  readonly siteId: string | null;
  /** Limit the pass to one class, for a targeted re-tune. */
  readonly abcClass: AbcClass | null;
  readonly trigger: RecalculationTrigger;
  readonly actorId: string | null;
  /** Injected by the tests. Defaults to the Prisma-backed repository. */
  readonly repository?: ParameterRepository;
}

/**
 * Whether this run may also reclassify.
 *
 * Both scopes must be absent. A Pareto is a statement about a whole population,
 * so ranking a subset and moving articles on the result would use evidence that
 * excludes most of the catalogue.
 *
 * The site check is also an authorisation boundary, not only a statistical one:
 * `abcClass` is a column on `Article`, shared by both plants, and
 * `threshold:recalculate` is held by the LTN1 warehouse manager — a single-site
 * role. Letting their run rewrite a cross-site attribute would hand a
 * site-scoped permission a global effect. The unscoped runs are the
 * administrator's and the nightly job's.
 */
function mayReclassify(run: RecalculationRun): boolean {
  return run.abcClass === null && run.siteId === null;
}

/**
 * Reclassifies articles by Pareto 80/15/5 (brief section 5, assumption 3).
 *
 * Runs *before* the thresholds on purpose: the class chooses which parameters
 * govern an article, so an article promoted to A must draw class A's safety
 * days in the same run. Two passes in the other order would leave every moved
 * article one run behind its own parameters.
 *
 * Returns how many actually moved. Only the changes are written — reasserting a
 * class an article already has would fill the audit log with non-events.
 */
async function reclassify(
  run: RecalculationRun,
  repository: ParameterRepository,
  since: Date,
): Promise<number> {
  const consumption = await repository.findConsumptionByArticle(since);
  const targets = await repository.findRecalculationTargets(null, null);

  const currentClassByArticle = new Map(
    targets.map((target) => [target.article.id, target.article.abcClass]),
  );

  const writes = classifyAbc(consumption)
    .filter((classification) => {
      const current = currentClassByArticle.get(classification.articleId);
      return current !== undefined && current !== classification.abcClass;
    })
    .map((classification) => ({
      articleId: classification.articleId,
      abcClass: classification.abcClass,
      audit: {
        entity: "Article",
        entityId: classification.articleId,
        action: "RECLASSIFY",
        before: { abcClass: currentClassByArticle.get(classification.articleId) ?? null },
        after: {
          abcClass: classification.abcClass,
          consumptionValue: classification.consumptionValue,
          cumulativeShare: classification.cumulativeShare,
        },
        actorId: run.actorId,
      },
    }));

  await repository.applyAbcClasses(writes);

  return writes.length;
}

/**
 * Recomputes thresholds from the movement journal (brief section 3.5).
 *
 * One transaction per article rather than one for the run: the unit that has to
 * be consistent is a stock item and its history row, and a single transaction
 * over the whole catalogue would hold locks across every screen in the
 * application while it ran.
 */
export async function runRecalculation(run: RecalculationRun): Promise<RecalculationResult> {
  const repository = run.repository ?? parameterRepository;
  const now = new Date();
  const since = new Date(now.getTime() - MAX_WINDOW_DAYS * MILLISECONDS_PER_DAY);

  const reclassified = mayReclassify(run) ? await reclassify(run, repository, since) : 0;

  const [targets, byClass] = await Promise.all([
    // Read after the reclassification, so a moved article is governed by the
    // class it has just been given rather than the one it is leaving.
    repository.findRecalculationTargets(run.siteId, run.abcClass),
    parametersByClass(repository),
  ]);

  const samples = await repository.findConsumptionSamples(
    targets.map((target) => target.id),
    since,
  );

  const samplesByStockItem = groupSamples(samples);
  let changed = 0;
  let nowCritical = 0;

  for (const target of targets) {
    const write = computeWrite({
      target,
      parameters: effectiveParameters(target, byClass),
      samples: samplesByStockItem.get(target.id) ?? [],
      context: { now, trigger: run.trigger, actorId: run.actorId },
    });

    if (hasChanged(target, write)) changed += 1;
    if (write.alertLevel === "CRITICAL" || write.alertLevel === "RUPTURE") nowCritical += 1;

    await repository.applyThresholdWithHistory(write);
  }

  return { evaluated: targets.length, changed, nowCritical, reclassified, runAt: now };
}

/** The manual trigger: the Recalculer button on the Parameters screen. */
export async function recalculate({
  actor,
  input,
  repository = parameterRepository,
}: ServiceParams<RecalculateInput>): Promise<RecalculationResult> {
  return runRecalculation({
    siteId: resolveSiteFilter(actor, input.siteId),
    abcClass: input.abcClass ?? null,
    trigger: "MANUAL",
    actorId: actor.userId,
    repository,
  });
}

/**
 * What governs one article, and whether somebody chose it.
 *
 * The `source` field is what lets the screen distinguish "running on the class
 * defaults" from "overridden for this reference" — clearing an override is only
 * a meaningful action in the second case.
 */
export async function forArticle({
  input,
  repository = parameterRepository,
}: ServiceParams<ArticleParameterInput>): Promise<ArticleParameters> {
  const article = await repository.findArticleForOverride(input.articleId);

  if (article === null) {
    throw new NotFoundError(`Article introuvable : ${input.articleId}`, {
      articleId: input.articleId,
    });
  }

  const override = await repository.findParameterForArticle(input.articleId);

  if (override !== null) {
    return {
      articleId: input.articleId,
      ...toClassParameters(override),
      source: "ARTICLE",
      abcClass: article.abcClass,
    };
  }

  const byClass = await parametersByClass(repository);
  const fallback =
    byClass.get(article.abcClass) ?? defaultParametersForClass(article.abcClass);

  return {
    articleId: input.articleId,
    ...fallback,
    source: "CLASS",
    abcClass: article.abcClass,
  };
}

function overridePayload(parameters: ClassParameters): AuditPayload {
  return {
    safetyDays: parameters.safetyDays,
    extraCoverageDays: parameters.extraCoverageDays,
    averagingWindowDays: parameters.averagingWindowDays,
    warningMarginRatio: parameters.warningMarginRatio,
  };
}

export async function upsertForArticle({
  actor,
  input,
  repository = parameterRepository,
}: ServiceParams<UpsertArticleParameterInput>): Promise<{ articleId: string }> {
  const article = await repository.findArticleForOverride(input.articleId);

  if (article === null) {
    throw new NotFoundError(`Article introuvable : ${input.articleId}`, {
      articleId: input.articleId,
    });
  }

  const existing = await repository.findParameterForArticle(input.articleId);

  const data = {
    safetyDays: input.safetyDays,
    extraCoverageDays: input.extraCoverageDays,
    averagingWindowDays: input.averagingWindowDays,
    warningMarginRatio: input.warningMarginRatio,
  };

  await repository.upsertArticleParameterWithAudit({
    articleId: input.articleId,
    data,
    audit: {
      entity: "ReplenishmentParameter",
      entityId: input.articleId,
      action: existing === null ? "CREATE" : "UPDATE",
      before: existing === null ? null : overridePayload(toClassParameters(existing)),
      after: overridePayload(data),
      actorId: actor.userId,
    },
  });

  return { articleId: input.articleId };
}

/** Drops an override so the article follows its class again. */
export async function clearForArticle({
  actor,
  input,
  repository = parameterRepository,
}: ServiceParams<ArticleParameterInput>): Promise<void> {
  const existing = await repository.findParameterForArticle(input.articleId);

  if (existing === null) {
    throw new BusinessRuleError("Cet article n a pas de parametres propres a supprimer.", {
      articleId: input.articleId,
    });
  }

  await repository.clearArticleParameterWithAudit({
    articleId: input.articleId,
    audit: {
      entity: "ReplenishmentParameter",
      entityId: input.articleId,
      action: "DELETE",
      before: overridePayload(toClassParameters(existing)),
      after: null,
      actorId: actor.userId,
    },
  });
}

export async function history({
  actor,
  input,
  repository = parameterRepository,
}: ServiceParams<ParameterHistoryInput>): Promise<readonly RecalculationHistoryItem[]> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const rows = await repository.findRecalculationHistory(siteId, input.limit);
  return rows.map(mapper.toHistoryItem);
}
