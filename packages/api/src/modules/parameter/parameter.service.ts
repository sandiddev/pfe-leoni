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
 * The stored thresholds are *not* recomputed here. Editing a parameter and
 * silently rewriting a thousand rows inside a form submission would make the
 * edit slow, unexplainable and hard to undo; the screen tells the
 * administrator to run a recalculation, which leaves its own trail.
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
    readonly actorId: string;
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
 * Recomputes thresholds from the movement journal (brief section 3.5).
 *
 * The manual trigger. A scheduled run would call exactly this, which is why the
 * trigger is a parameter rather than a constant — wiring a nightly job later is
 * a route handler, not a redesign.
 *
 * One transaction per article rather than one for the run: the unit that has to
 * be consistent is a stock item and its history row, and a single transaction
 * over the whole catalogue would hold locks across every screen in the
 * application while it ran.
 */
export async function recalculate({
  actor,
  input,
  repository = parameterRepository,
}: ServiceParams<RecalculateInput>): Promise<RecalculationResult> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const now = new Date();

  const [targets, byClass] = await Promise.all([
    repository.findRecalculationTargets(siteId, input.abcClass ?? null),
    parametersByClass(repository),
  ]);

  const samples = await repository.findConsumptionSamples(
    targets.map((target) => target.id),
    new Date(now.getTime() - MAX_WINDOW_DAYS * MILLISECONDS_PER_DAY),
  );

  const samplesByStockItem = groupSamples(samples);
  let changed = 0;
  let nowCritical = 0;

  for (const target of targets) {
    const write = computeWrite({
      target,
      parameters: effectiveParameters(target, byClass),
      samples: samplesByStockItem.get(target.id) ?? [],
      context: { now, trigger: "MANUAL", actorId: actor.userId },
    });

    if (hasChanged(target, write)) changed += 1;
    if (write.alertLevel === "CRITICAL" || write.alertLevel === "RUPTURE") nowCritical += 1;

    await repository.applyThresholdWithHistory(write);
  }

  return { evaluated: targets.length, changed, nowCritical, runAt: now };
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
