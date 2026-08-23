import type {
  ArticleByIdInput,
  ArticleDetail,
  ArticleListInput,
  ArticleListItem,
  Page,
  UpdateArticleInput,
} from "@leoni/contracts";
import { computeLegacyThresholds, daysOfCoverage, DEFAULT_WARNING_MARGIN_RATIO } from "@leoni/core";

import type { Actor } from "../../context";
import { assertCanAccessSite, resolveSiteFilter } from "../../middlewares/site-scope";
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

interface ParameterSet {
  readonly safetyDays: number;
  readonly extraCoverageDays: number;
  readonly warningMarginRatio: number;
}

const FALLBACK_PARAMETERS: ParameterSet = {
  safetyDays: 1,
  extraCoverageDays: 10,
  warningMarginRatio: DEFAULT_WARNING_MARGIN_RATIO,
};

/**
 * Loads the tuning parameters for every ABC class once per request.
 *
 * The alternative — looking them up per article — would issue one query per row
 * on a 150-row page. There are exactly three classes, so they are fetched once
 * and shared.
 */
async function loadParametersByClass(): Promise<Map<string, ParameterSet>> {
  const classes = ["A", "B", "C"] as const;
  const parameters = await Promise.all(
    classes.map(async (abcClass) => repository.findParameterForClass(abcClass)),
  );

  const byClass = new Map<string, ParameterSet>();

  for (const [index, parameter] of parameters.entries()) {
    const abcClass = classes[index];
    if (abcClass === undefined) continue;

    byClass.set(
      abcClass,
      parameter === null
        ? FALLBACK_PARAMETERS
        : {
            safetyDays: parameter.safetyDays.toNumber(),
            extraCoverageDays: parameter.extraCoverageDays.toNumber(),
            warningMarginRatio: parameter.warningMarginRatio.toNumber(),
          },
    );
  }

  return byClass;
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
    const parameters = parametersByClass.get(row.article.abcClass) ?? FALLBACK_PARAMETERS;
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
    throw new ArticleNotFoundError(input.articleId);
  }

  // A filter cannot protect a lookup by id, so the row that came back is
  // checked against the actor's plant.
  assertCanAccessSite(actor, row.site.id);

  const parametersByClass = await loadParametersByClass();
  const parameters = parametersByClass.get(row.article.abcClass) ?? FALLBACK_PARAMETERS;

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

/**
 * Updates article master data.
 *
 * Authorisation is the router's concern (`article:write`, Administrator only).
 * What belongs here is the consequence: changing the VPE or the lead time
 * invalidates the stored thresholds, and the caller is told so rather than
 * being left with figures that no longer match the article they describe.
 */
export async function update(
  _actor: Actor,
  input: UpdateArticleInput,
): Promise<{ articleId: string; thresholdsNeedRecalculation: boolean }> {
  const existing = await repository.findRawArticle(input.articleId);

  if (existing === null) {
    throw new ArticleNotFoundError(input.articleId);
  }

  const thresholdsNeedRecalculation =
    existing.leadTimeDays !== input.leadTimeDays || existing.abcClass !== input.abcClass;

  await repository.update(input.articleId, {
    designation: input.designation,
    vpe: input.vpe,
    leadTimeDays: input.leadTimeDays,
    abcClass: input.abcClass,
    isActive: input.isActive,
  });

  return { articleId: input.articleId, thresholdsNeedRecalculation };
}

/** Raised when an article is absent, or invisible to the caller. */
export class ArticleNotFoundError extends Error {
  readonly code = "ARTICLE_NOT_FOUND";

  constructor(articleId: string) {
    super(`Article introuvable : ${articleId}`);
    this.name = "ArticleNotFoundError";
  }
}
