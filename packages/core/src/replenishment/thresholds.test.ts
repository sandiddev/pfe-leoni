import { describe, expect, it } from "vitest";

import { InvalidInputError } from "../errors/domain-error";
import { computeLegacyThresholds } from "./legacy-thresholds";
import { computeMax, computeMin, computeSafetyStock, computeThresholds } from "./thresholds";

describe("computeThresholds — enriched model (brief section 3.2)", () => {
  /**
   * The reference example from section 3.3 of the brief, reproduced exactly.
   * If this test ever fails, the application no longer implements the model
   * that the report defends.
   */
  it("reproduces the reference example from the brief", () => {
    const result = computeThresholds({
      averageDailyConsumption: 500,
      leadTimeDays: 2,
      safetyDays: 1, // 500 units/day x 1 day = 500 units of safety stock
      extraCoverageDays: 3,
    });

    expect(result.safetyStock).toBe(500);
    expect(result.min).toBe(1_500); // (500 x 2) + 500
    expect(result.max).toBe(3_000); // 1 500 + (500 x 3)
  });

  it("applies the ABC class A defaults from section 3.4", () => {
    // Class A: safety stock 2 days, extra coverage 3 days.
    const result = computeThresholds({
      averageDailyConsumption: 120,
      leadTimeDays: 2,
      safetyDays: 2,
      extraCoverageDays: 3,
    });

    expect(result.safetyStock).toBe(240);
    expect(result.min).toBe(480); // 120 x (2 + 2)
    expect(result.max).toBe(840); // 480 + 120 x 3
  });

  it("applies the ABC class C defaults from section 3.4", () => {
    // Class C: safety stock 1 day, extra coverage 10 days — a slow mover is
    // replenished rarely but deeply.
    const result = computeThresholds({
      averageDailyConsumption: 10,
      leadTimeDays: 2,
      safetyDays: 1,
      extraCoverageDays: 10,
    });

    expect(result.safetyStock).toBe(10);
    expect(result.min).toBe(30);
    expect(result.max).toBe(130);
  });

  it("always satisfies safetyStock <= min <= max", () => {
    const cases = [
      { averageDailyConsumption: 0, leadTimeDays: 0, safetyDays: 0, extraCoverageDays: 0 },
      { averageDailyConsumption: 1, leadTimeDays: 0, safetyDays: 5, extraCoverageDays: 0 },
      { averageDailyConsumption: 37.4, leadTimeDays: 1.5, safetyDays: 2.25, extraCoverageDays: 7 },
      { averageDailyConsumption: 9999, leadTimeDays: 30, safetyDays: 15, extraCoverageDays: 45 },
    ];

    for (const input of cases) {
      const { safetyStock, min, max } = computeThresholds(input);
      expect(safetyStock).toBeLessThanOrEqual(min);
      expect(min).toBeLessThanOrEqual(max);
    }
  });

  it("rounds thresholds up so the safety margin is never eroded by rounding", () => {
    // 33.33 x (2 + 1) = 99.99 — rounding down would trigger replenishment one
    // unit later than the model says.
    const result = computeThresholds({
      averageDailyConsumption: 33.33,
      leadTimeDays: 2,
      safetyDays: 1,
      extraCoverageDays: 0,
    });

    expect(result.min).toBe(100);
  });

  it("returns zero thresholds for an article with no consumption", () => {
    const result = computeThresholds({
      averageDailyConsumption: 0,
      leadTimeDays: 5,
      safetyDays: 2,
      extraCoverageDays: 3,
    });

    expect(result).toStrictEqual({ safetyStock: 0, min: 0, max: 0 });
  });

  it.each([
    ["averageDailyConsumption", { averageDailyConsumption: -1 }],
    ["leadTimeDays", { leadTimeDays: -1 }],
    ["safetyDays", { safetyDays: -1 }],
    ["extraCoverageDays", { extraCoverageDays: -1 }],
  ])("rejects a negative %s", (_label, override) => {
    expect(() =>
      computeThresholds({
        averageDailyConsumption: 100,
        leadTimeDays: 2,
        safetyDays: 1,
        extraCoverageDays: 3,
        ...override,
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects a non-finite input", () => {
    expect(() =>
      computeThresholds({
        averageDailyConsumption: Number.NaN,
        leadTimeDays: 2,
        safetyDays: 1,
        extraCoverageDays: 3,
      }),
    ).toThrow(InvalidInputError);
  });
});

describe("individual threshold functions", () => {
  it("agree with computeThresholds", () => {
    const inputs = {
      averageDailyConsumption: 500,
      leadTimeDays: 2,
      safetyDays: 1,
      extraCoverageDays: 3,
    };

    expect(computeSafetyStock(inputs)).toBe(computeThresholds(inputs).safetyStock);
    expect(computeMin(inputs)).toBe(computeThresholds(inputs).min);
    expect(computeMax(inputs)).toBe(computeThresholds(inputs).max);
  });
});

describe("computeLegacyThresholds — the logistics study's model (section 3.1)", () => {
  it("reproduces the original formulas", () => {
    const result = computeLegacyThresholds({
      averageDailyConsumption: 500,
      leadTimeDays: 2,
      safetyStock: 500,
    });

    expect(result.min).toBe(1_000); // 500 x 2, safety stock NOT in the trigger
    expect(result.max).toBe(1_500); // 1 000 + 500
  });

  /**
   * This is the comparison the report defends: on identical data the enriched
   * model triggers earlier and refills higher, which is the entire point of
   * moving the safety stock into the reorder point.
   */
  it("triggers later than the enriched model on identical data", () => {
    const shared = { averageDailyConsumption: 500, leadTimeDays: 2 };

    const legacy = computeLegacyThresholds({ ...shared, safetyStock: 500 });
    const enriched = computeThresholds({ ...shared, safetyDays: 1, extraCoverageDays: 3 });

    expect(legacy.min).toBeLessThan(enriched.min);
    expect(legacy.max).toBeLessThan(enriched.max);
  });
});
