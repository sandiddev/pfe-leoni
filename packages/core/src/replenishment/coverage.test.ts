import { describe, expect, it } from "vitest";

import { daysOfCoverage, isCoverageBelowLeadTime } from "./coverage";

describe("daysOfCoverage", () => {
  it("expresses stock in days of production", () => {
    expect(daysOfCoverage(3_000, 500)).toBe(6);
  });

  it("rounds to one decimal, which is the precision the screen shows", () => {
    expect(daysOfCoverage(1_000, 300)).toBe(3.3);
  });

  it("returns null rather than Infinity for an article with no consumption", () => {
    // Infinity would sort to the top of a best-covered table and render as a
    // meaningless value; null forces the caller to decide how to present it.
    expect(daysOfCoverage(5_000, 0)).toBeNull();
  });

  it("returns zero coverage for an article in rupture", () => {
    expect(daysOfCoverage(0, 500)).toBe(0);
    expect(daysOfCoverage(-10, 500)).toBe(0);
  });
});

describe("isCoverageBelowLeadTime", () => {
  it("flags an article that will run out before LTN4 can resupply", () => {
    expect(isCoverageBelowLeadTime(1.5, 2)).toBe(true);
  });

  it("does not flag an article with exactly enough coverage", () => {
    expect(isCoverageBelowLeadTime(2, 2)).toBe(false);
  });

  it("does not flag an article that is not consumed", () => {
    expect(isCoverageBelowLeadTime(null, 2)).toBe(false);
  });
});
