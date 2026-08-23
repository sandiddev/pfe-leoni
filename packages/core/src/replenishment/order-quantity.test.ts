import { describe, expect, it } from "vitest";

import { InvalidInputError } from "../errors/domain-error";
import { computeBoxCount, computeNeed, computeOrderQuantity } from "./order-quantity";

describe("computeOrderQuantity (brief section 3.3)", () => {
  it("reproduces the reference example from the brief", () => {
    const result = computeOrderQuantity({
      currentStock: 1_200,
      min: 1_500,
      max: 3_000,
      vpe: 500,
    });

    expect(result.isReplenishmentNeeded).toBe(true);
    expect(result.need).toBe(1_800); // 3 000 - 1 200
    expect(result.boxCount).toBe(4); // ceil(1 800 / 500)
    expect(result.recommendedQuantity).toBe(2_000); // 4 x 500
  });

  it("proposes nothing while stock is above the reorder point", () => {
    const result = computeOrderQuantity({
      currentStock: 1_600,
      min: 1_500,
      max: 3_000,
      vpe: 500,
    });

    expect(result).toStrictEqual({
      isReplenishmentNeeded: false,
      need: 0,
      boxCount: 0,
      recommendedQuantity: 0,
    });
  });

  it("triggers exactly at the reorder point, not one unit below", () => {
    const atMin = computeOrderQuantity({ currentStock: 1_500, min: 1_500, max: 3_000, vpe: 500 });
    expect(atMin.isReplenishmentNeeded).toBe(true);

    const oneAbove = computeOrderQuantity({
      currentStock: 1_501,
      min: 1_500,
      max: 3_000,
      vpe: 500,
    });
    expect(oneAbove.isReplenishmentNeeded).toBe(false);
  });

  it("always rounds up to a whole box, never down", () => {
    // Need is 1 unit; the smallest thing LTN4 can ship is one full box.
    const result = computeOrderQuantity({ currentStock: 99, min: 100, max: 100, vpe: 500 });

    expect(result.need).toBe(1);
    expect(result.boxCount).toBe(1);
    expect(result.recommendedQuantity).toBe(500);
    expect(result.recommendedQuantity).toBeGreaterThanOrEqual(result.need);
  });

  it("does not over-order when the need is an exact multiple of the pack size", () => {
    const result = computeOrderQuantity({ currentStock: 1_000, min: 1_500, max: 3_000, vpe: 500 });

    expect(result.need).toBe(2_000);
    expect(result.boxCount).toBe(4);
    expect(result.recommendedQuantity).toBe(2_000);
  });

  it("handles articles sold by the unit (VPE = 1)", () => {
    const result = computeOrderQuantity({ currentStock: 7, min: 10, max: 23, vpe: 1 });

    expect(result.need).toBe(16);
    expect(result.boxCount).toBe(16);
    expect(result.recommendedQuantity).toBe(16);
  });

  it("proposes a full refill for an article already in rupture", () => {
    const result = computeOrderQuantity({ currentStock: 0, min: 1_500, max: 3_000, vpe: 500 });

    expect(result.need).toBe(3_000);
    expect(result.recommendedQuantity).toBe(3_000);
  });

  it("treats negative stock (an inventory error) as a need for the full target", () => {
    const result = computeOrderQuantity({ currentStock: -50, min: 1_500, max: 3_000, vpe: 500 });

    expect(result.need).toBe(3_050);
    expect(result.boxCount).toBe(7);
    expect(result.recommendedQuantity).toBe(3_500);
  });

  it("proposes nothing when stock sits exactly at Max", () => {
    const result = computeOrderQuantity({ currentStock: 3_000, min: 3_000, max: 3_000, vpe: 500 });

    expect(result.isReplenishmentNeeded).toBe(true);
    expect(result.need).toBe(0);
    expect(result.boxCount).toBe(0);
    expect(result.recommendedQuantity).toBe(0);
  });

  it("rejects a zero or negative pack size", () => {
    expect(() => computeOrderQuantity({ currentStock: 0, min: 10, max: 20, vpe: 0 })).toThrow(
      InvalidInputError,
    );
    expect(() => computeOrderQuantity({ currentStock: 0, min: 10, max: 20, vpe: -5 })).toThrow(
      InvalidInputError,
    );
  });

  it("rejects inconsistent thresholds", () => {
    expect(() => computeOrderQuantity({ currentStock: 0, min: 100, max: 50, vpe: 10 })).toThrow(
      InvalidInputError,
    );
  });
});

describe("computeNeed", () => {
  it("never returns a negative need", () => {
    expect(computeNeed({ currentStock: 5_000, max: 3_000 })).toBe(0);
  });
});

describe("computeBoxCount", () => {
  it("returns zero boxes for a zero or negative need", () => {
    expect(computeBoxCount(0, 500)).toBe(0);
    expect(computeBoxCount(-10, 500)).toBe(0);
  });

  it("rounds a fractional pack requirement up", () => {
    expect(computeBoxCount(501, 500)).toBe(2);
  });
});
