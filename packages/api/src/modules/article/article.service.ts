import type {
  ArticleByIdInput,
  ArticleDetail,
  ArticleListInput,
  ArticleListItem,
  Page,
  UpdateArticleInput,
} from "@leoni/contracts";
import {
  ABC_CLASSES,
  type AbcClass,
  type ClassParameters,
  computeLegacyThresholds,
  daysOfCoverage,
  defaultParametersForClass,
  NotFoundError,
} from "@leoni/core";

import type { Actor } from "../../context";
import { assertCanAccessSite, resolveSiteFilter } from "../../middlewares/site-scope";
import type { AuditPayload } from "../../shared/audit";
import * as mapper from "./article.mapper";
import * as repository from "./article.repository";

/**
 * Business rules for the article module.
 *
 * The service is where a request becomes a decision: it resolves what the actor
 * is allowed to see, asks the repository for rows, and hands them to the domain
 * layer to be interpreted. It contains no SQL and no HTTP.
 */

const MOVEMENT_HISTORY_LIMIT = 25;
const THRESHOLD_HISTORY_LIMIT = 30;

/**
 * Loads the tuning parameters for every ABC class once per request.
 *
 * The alternative — looking them up per article — would issue one query per row
 * on a 150-row page. There are exactly three classes, so they are fetched once
 * and shared.
 *
 * A class with no row falls back to `DEFAULT_CLASS_PARAMETERS`, which is the
 * only place those defaults are written. The map is total over `ABC_CLASSES`,
 * so callers index it without a fallback of their own — three call sites
 * previously each carried one, and one of them disagreed with the other two.
 */
async function loadParametersByClass(): Promise<ReadonlyMap<AbcClass, ClassParameters>> {
  const parameters = await Promise.all(
    ABC_CLASSES.map(async (abcClass) => ({
      abcClass,
      row: await repository.findParameterForClass(abcClass),
    })),
  );

  return new Map(
    parameters.map(({ abcClass, row }) => [
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
 * Reads a class out of the map built above.
 *
 * The map is total, but `Map.get` is typed as possibly-undefined and there is
 * no honest way to tell the compiler otherwise. Narrowing here — once, with the
 * same defaults as the loader — beats a `!` at each call site.
 */
function parametersFor(
  byClass: ReadonlyMap<AbcClass, ClassParameters>,
  abcClass: AbcClass,
): ClassParameters {
  return byClass.get(abcClass) ?? defaultParametersForClass(abcClass);
}

export async function list(actor: Actor, input: ArticleListInput): Promise<Page<ArticleListItem>> {
  // Whatever site the client asked for, this is the site it actually gets.
  const siteId = resolveSiteFilter(actor, input.siteId);

  const [{ rows, totalCount }, parametersByClass] = await Promise.all([
    repository.findMany({ input, siteId }),
    loadParametersByClass(),
  ]);

  // The extra row fetched by the repository answers "is there another page?"
  // and must not be returned to the client.
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  const items = page.map((row) => {
    const parameters = parametersFor(parametersByClass, row.article.abcClass);
    return mapper.toListItem({
      row,
      safetyDays: parameters.safetyDays,
      extraCoverageDays: parameters.extraCoverageDays,
      warningMarginRatio: parameters.warningMarginRatio,
    });
  });

  // Coverage is not a column, so the database could only approximate this sort.
  // Re-sorting the page here makes the displayed order exact. It is a page-local
  // correction, and the screen documents that coverage sorting is within-page.
  const sorted =
    input.sortBy === "coverageDays"
      ? [...items].sort((left, right) => {
          // Articles with no consumption have no coverage; they belong at the
          // end either way rather than sorting as zero.
          const leftValue = left.coverageDays ?? Number.POSITIVE_INFINITY;
          const rightValue = right.coverageDays ?? Number.POSITIVE_INFINITY;
          return input.sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
        })
      : items;

  return {
    items: sorted,
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    totalCount,
  };
}

export async function byId(actor: Actor, input: ArticleByIdInput): Promise<ArticleDetail> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const row = await repository.findByArticleAndSite(input.articleId, siteId);

  if (row === null) {
    // Deliberately the same message whether the article does not exist or the
    // actor may not see it: distinguishing them would let a user enumerate the
    // other plant's catalogue by identifier.
    throw new NotFoundError(`Article introuvable : ${input.articleId}`, {
      articleId: input.articleId,
    });
  }

  // A filter cannot protect a lookup by id, so the row that came back is
  // checked against the actor's plant.
  assertCanAccessSite(actor, row.site.id);

  const parametersByClass = await loadParametersByClass();
  const parameters = parametersFor(parametersByClass, row.article.abcClass);

  const [lots, movements, thresholdHistory] = await Promise.all([
    repository.findLots(row.id),
    repository.findRecentMovements(row.id, MOVEMENT_HISTORY_LIMIT),
    repository.findThresholdHistory(row.id, THRESHOLD_HISTORY_LIMIT),
  ]);

  const base = mapper.toListItem({
    row,
    safetyDays: parameters.safetyDays,
    extraCoverageDays: parameters.extraCoverageDays,
    warningMarginRatio: parameters.warningMarginRatio,
  });

  // What the logistics study's original model (section 3.1) would have produced
  // on this same article, so the enrichment can be defended with numbers.
  const legacy = computeLegacyThresholds({
    averageDailyConsumption: base.averageDailyConsumption,
    leadTimeDays: base.leadTimeDays,
    safetyStock: base.safetyStock,
  });

  return {
    ...base,
    coverageDays: daysOfCoverage(base.currentStock, base.averageDailyConsumption),
    lots: lots.map(mapper.toLotItem),
    recentMovements: movements.map(mapper.toMovementItem),
    thresholdHistory: thresholdHistory.map(mapper.toThresholdHistoryPoint),
    legacyThresholds: { min: legacy.min, max: legacy.max },
  };
}

/** The master-data fields this operation can change, and therefore audits. */
const AUDITED_ARTICLE_FIELDS = [
  "designation",
  "vpe",
  "leadTimeDays",
  "abcClass",
  "isActive",
] as const;

interface AuditableArticle {
  readonly designation: string;
  readonly vpe: number;
  readonly leadTimeDays: number;
  readonly abcClass: AbcClass;
  readonly isActive: boolean;
}

function auditedFields(article: AuditableArticle): AuditPayload {
  return Object.fromEntries(AUDITED_ARTICLE_FIELDS.map((field) => [field, article[field]]));
}

/**
 * Updates article master data.
 *
 * Authorisation is the router's concern (`article:write`, Administrator only).
 * What belongs here is the consequence: changing the VPE or the lead time
 * invalidates the stored thresholds, and the caller is told so rather than
 * being left with figures that no longer match the article they describe.
 *
 * The change is audited. Min, Max, VPE and lead time are the numbers every
 * threshold in the application derives from, so "who changed this, and from
 * what" has to be answerable months later — that is what `AuditLog` is for, and
 * the repository writes it in the same transaction as the row.
 */
export async function update(
  actor: Actor,
  input: UpdateArticleInput,
): Promise<{ articleId: string; thresholdsNeedRecalculation: boolean }> {
  const existing = await repository.findRawArticle(input.articleId);

  if (existing === null) {
    throw new NotFoundError(`Article introuvable : ${input.articleId}`, {
      articleId: input.articleId,
    });
  }

  const thresholdsNeedRecalculation =
    existing.leadTimeDays !== input.leadTimeDays || existing.abcClass !== input.abcClass;

  const data = {
    designation: input.designation,
    vpe: input.vpe,
    leadTimeDays: input.leadTimeDays,
    abcClass: input.abcClass,
    isActive: input.isActive,
  };

  await repository.updateWithAudit({
    articleId: input.articleId,
    data,
    audit: {
      entity: "Article",
      entityId: input.articleId,
      action: "UPDATE",
      // Both sides are recorded so a change can be explained without replaying
      // the whole log, and narrowed to the fields this operation can touch —
      // storing timestamps and ids would bury the two numbers that matter.
      before: auditedFields(existing),
      after: auditedFields(data),
      actorId: actor.userId,
    },
  });

  return { articleId: input.articleId, thresholdsNeedRecalculation };
}
