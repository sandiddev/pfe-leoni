import { describe, expect, it } from "vitest";

import { assessStockItem } from "./stock-assessment";

describe("assessStockItem", () => {
  /**
   * The full reference scenario of the brief, end to end: from a consumption
   * rate and a set of parameters through to the quantity the storekeeper is
   * asked to validate. This is the single test that proves the chain of
   * formulas in sections 3.2 and 3.3 composes correctly.
   */
  it("reproduces the reference scenario from the brief end to end", () => {
    const assessment = assessStockItem({
      currentStock: 1_200,
      averageDailyConsumption: 500,
      leadTimeDays: 2,
      safetyDays: 1,
      extraCoverageDays: 3,
      vpe: 500,
    });

    expect(assessment.thresholds).toStrictEqual({ safetyStock: 500, min: 1_500, max: 3_000 });
    expect(assessment.alertLevel).toBe("CRITICAL");
    expect(assessment.coverageDays).toBe(2.4);
    expect(assessment.order.need).toBe(1_800);
    expect(assessment.order.boxCount).toBe(4);
    expect(assessment.order.recommendedQuantity).toBe(2_000);
  });

  it("does not raise an order for a healthy article", () => {
    const assessment = assessStockItem({
      currentStock: 2_800,
      averageDailyConsumption: 500,
      leadTimeDays: 2,
      safetyDays: 1,
      extraCoverageDays: 3,
      vpe: 500,
    });

    expect(assessment.alertLevel).toBe("NORMAL");
    expect(assessment.order.isReplenishmentNeeded).toBe(false);
    expect(assessment.willRunOutBeforeResupply).toBe(false);
  });

  it("warns that an article will starve the line before LTN4 can resupply", () => {
    const assessment = assessStockItem({
      currentStock: 500,
      averageDailyConsumption: 500,
      leadTimeDays: 2,
      safetyDays: 1,
      extraCoverageDays: 3,
      vpe: 500,
    });

    expect(assessment.coverageDays).toBe(1);
    expect(assessment.willRunOutBeforeResupply).toBe(true);
    expect(assessment.alertLevel).toBe("CRITICAL");
  });

  it("reports rupture and a full refill when stock is exhausted", () => {
    const assessment = assessStockItem({
      currentStock: 0,
      averageDailyConsumption: 500,
      leadTimeDays: 2,
      safetyDays: 1,
      extraCoverageDays: 3,
      vpe: 500,
    });

    expect(assessment.alertLevel).toBe("RUPTURE");
    expect(assessment.coverageDays).toBe(0);
    expect(assessment.order.recommendedQuantity).toBe(3_000);
  });

  it("leaves a non-consumed article alone instead of proposing an order", () => {
    const assessment = assessStockItem({
      currentStock: 40,
      averageDailyConsumption: 0,
      leadTimeDays: 2,
      safetyDays: 1,
      extraCoverageDays: 3,
      vpe: 10,
    });

    expect(assessment.thresholds.min).toBe(0);
    expect(assessment.alertLevel).toBe("NORMAL");
    expect(assessment.coverageDays).toBeNull();
    expect(assessment.order.isReplenishmentNeeded).toBe(false);
  });

  it("honours a configured warning margin", () => {
    const inputs = {
      currentStock: 1_700,
      averageDailyConsumption: 500,
      leadTimeDays: 2,
      safetyDays: 1,
      extraCoverageDays: 3,
      vpe: 500,
    };

    expect(assessStockItem(inputs).alertLevel).toBe("WARNING");
    expect(assessStockItem({ ...inputs, warningMarginRatio: 0.05 }).alertLevel).toBe("NORMAL");
  });
});
