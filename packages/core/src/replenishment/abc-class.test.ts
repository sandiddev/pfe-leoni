import { describe, expect, it } from "vitest";

import { InvalidInputError } from "../errors/domain-error";
import { type ClassifiableArticle, classifyAbc } from "./abc-class";

function byId(results: ReturnType<typeof classifyAbc>): Record<string, string> {
  return Object.fromEntries(results.map((result) => [result.articleId, result.abcClass]));
}

describe("classifyAbc (brief section 2, Pareto 80/15/5)", () => {
  it("puts the articles that make up 80 percent of consumption in class A", () => {
    const articles: ClassifiableArticle[] = [
      { articleId: "A1", consumptionValue: 800 },
      { articleId: "B1", consumptionValue: 150 },
      { articleId: "C1", consumptionValue: 50 },
    ];

    expect(byId(classifyAbc(articles))).toStrictEqual({ A1: "A", B1: "B", C1: "C" });
  });

  it("counts the boundary article as part of the class it completes", () => {
    // Two articles at 40 percent each: the second carries the cumulative share
    // to exactly 80 percent, so it belongs to A as part of what makes up 80.
    const articles: ClassifiableArticle[] = [
      { articleId: "A1", consumptionValue: 40 },
      { articleId: "A2", consumptionValue: 40 },
      { articleId: "B1", consumptionValue: 15 },
      { articleId: "C1", consumptionValue: 5 },
    ];

    expect(byId(classifyAbc(articles))).toStrictEqual({
      A1: "A",
      A2: "A",
      B1: "B",
      C1: "C",
    });
  });

  it("ranks by descending consumption regardless of input order", () => {
    const articles: ClassifiableArticle[] = [
      { articleId: "small", consumptionValue: 5 },
      { articleId: "big", consumptionValue: 950 },
      { articleId: "medium", consumptionValue: 45 },
    ];

    const results = classifyAbc(articles);
    expect(results.map((result) => result.articleId)).toStrictEqual(["big", "medium", "small"]);
  });

  it("is stable between runs when values tie", () => {
    // A classification that reshuffles on every recalculation would make the
    // threshold history impossible to interpret afterwards.
    const articles: ClassifiableArticle[] = [
      { articleId: "Z", consumptionValue: 100 },
      { articleId: "A", consumptionValue: 100 },
      { articleId: "M", consumptionValue: 100 },
    ];

    const first = classifyAbc(articles).map((result) => result.articleId);
    const second = classifyAbc([...articles].reverse()).map((result) => result.articleId);

    expect(first).toStrictEqual(["A", "M", "Z"]);
    expect(second).toStrictEqual(first);
  });

  it("reports cumulative shares that reach 100 percent", () => {
    const results = classifyAbc([
      { articleId: "A1", consumptionValue: 80 },
      { articleId: "B1", consumptionValue: 20 },
    ]);

    expect(results.at(-1)?.cumulativeShare).toBeCloseTo(1, 10);
  });

  it("classifies a freshly imported catalogue with no history as class C", () => {
    const results = classifyAbc([
      { articleId: "A1", consumptionValue: 0 },
      { articleId: "A2", consumptionValue: 0 },
    ]);

    expect(results.every((result) => result.abcClass === "C")).toBe(true);
  });

  it("honours custom Pareto shares", () => {
    const articles: ClassifiableArticle[] = [
      { articleId: "A1", consumptionValue: 50 },
      { articleId: "A2", consumptionValue: 30 },
      { articleId: "C1", consumptionValue: 20 },
    ];

    // A 50/25 split moves the second article out of class A.
    expect(byId(classifyAbc(articles, { classAShare: 0.5, classBShare: 0.25 }))).toStrictEqual({
      A1: "A",
      A2: "B",
      C1: "C",
    });
  });

  it("rejects shares that leave no room for class C", () => {
    expect(() => classifyAbc([], { classAShare: 0.8, classBShare: 0.2 })).toThrow(
      InvalidInputError,
    );
  });

  it("rejects a negative consumption value", () => {
    expect(() => classifyAbc([{ articleId: "A1", consumptionValue: -1 }])).toThrow(
      InvalidInputError,
    );
  });
});
