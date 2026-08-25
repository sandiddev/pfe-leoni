import { InvalidInputError } from "../errors/domain-error";

/**
 * ABC classification (brief section 2).
 *
 * A = high demand, B = medium, C = low. The class is supplied by the article
 * master data, but the application must also be able to recompute it from
 * observed consumption so the parameters stay honest as demand shifts.
 */
export const ABC_CLASSES = ["A", "B", "C"] as const;
export type AbcClass = (typeof ABC_CLASSES)[number];

export function isAbcClass(value: string): value is AbcClass {
  return ABC_CLASSES.some((abcClass) => abcClass === value);
}

/** Cumulative share of total consumption value at which each class ends. */
export interface ParetoThresholds {
  /** Share of cumulative value covered by class A. Default 0.80. */
  readonly classAShare: number;
  /** Additional share covered by class B. Default 0.15 (so A+B = 0.95). */
  readonly classBShare: number;
}

export const DEFAULT_PARETO: ParetoThresholds = {
  classAShare: 0.8,
  classBShare: 0.15,
};

export interface ClassifiableArticle {
  readonly articleId: string;
  /**
   * Consumption value over the analysis period. Where a unit cost is unknown
   * (as is the case in the LEONI export) this is the consumed quantity, which
   * makes the classification a pure volume Pareto — an assumption to state.
   */
  readonly consumptionValue: number;
}

/**
 * Tolerance for the cumulative-share comparisons.
 *
 * Binary floating point cannot represent these shares exactly: `0.8 + 0.15`
 * evaluates to 0.9500000000000001, so an article whose cumulative share is
 * exactly 0.95 would test as *below* the class B limit and be misclassified as
 * B instead of C. A tolerance of 1e-9 is far smaller than any share a real
 * catalogue produces and far larger than the accumulated rounding error.
 */
const CUMULATIVE_SHARE_TOLERANCE = 1e-9;

function isBelow(value: number, limit: number): boolean {
  return value < limit - CUMULATIVE_SHARE_TOLERANCE;
}

export interface AbcClassification {
  readonly articleId: string;
  readonly consumptionValue: number;
  /** Share of the grand total this article alone represents. */
  readonly share: number;
  /** Cumulative share up to and including this article. */
  readonly cumulativeShare: number;
  readonly abcClass: AbcClass;
}

/**
 * Classifies articles by the Pareto method (section 2).
 *
 * Articles are ranked by descending consumption value; the first ones that
 * together account for `classAShare` of the total are class A, the next
 * `classBShare` are class B, the remainder are class C.
 *
 * Ties are broken by `articleId` so the result is stable between runs — a
 * classification that reshuffles on every recalculation would make the
 * threshold history impossible to interpret.
 */
export function classifyAbc(
  articles: readonly ClassifiableArticle[],
  thresholds: ParetoThresholds = DEFAULT_PARETO,
): AbcClassification[] {
  const { classAShare, classBShare } = thresholds;

  if (classAShare <= 0 || classBShare <= 0 || classAShare + classBShare >= 1) {
    throw new InvalidInputError("Pareto shares must be positive and leave room for class C.", {
      classAShare,
      classBShare,
    });
  }
  if (articles.some((article) => article.consumptionValue < 0)) {
    throw new InvalidInputError("Consumption value cannot be negative.");
  }

  const total = articles.reduce((sum, article) => sum + article.consumptionValue, 0);

  // With no consumption at all there is no Pareto to compute; everything is a
  // slow mover. Returning class C is more useful than throwing here, because a
  // freshly imported catalogue legitimately has no movement history yet.
  if (total === 0) {
    return articles.map((article) => ({
      articleId: article.articleId,
      consumptionValue: article.consumptionValue,
      share: 0,
      cumulativeShare: 0,
      abcClass: "C" as const,
    }));
  }

  const ranked = [...articles].sort((left, right) => {
    const byValue = right.consumptionValue - left.consumptionValue;
    return byValue !== 0 ? byValue : left.articleId.localeCompare(right.articleId);
  });

  const classBLimit = classAShare + classBShare;
  let cumulative = 0;

  return ranked.map((article) => {
    const share = article.consumptionValue / total;

    // Captured before accumulating rather than recovered by subtraction: the
    // boundary article — the one that carries the cumulative share past 80% —
    // belongs to class A, not B, because it is part of what makes up that 80%.
    const previousCumulative = cumulative;
    cumulative += share;

    const abcClass: AbcClass = isBelow(previousCumulative, classAShare)
      ? "A"
      : isBelow(previousCumulative, classBLimit)
        ? "B"
        : "C";

    return {
      articleId: article.articleId,
      consumptionValue: article.consumptionValue,
      share,
      cumulativeShare: cumulative,
      abcClass,
    };
  });
}
