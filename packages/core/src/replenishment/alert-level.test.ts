import { describe, expect, it } from "vitest";

import { InvalidInputError } from "../errors/domain-error";
import {
  compareAlertSeverityDesc,
  crossedIntoShortage,
  isAtLeastAsSevere,
  resolveAlertLevel,
} from "./alert-level";

describe("resolveAlertLevel (brief section 6.1)", () => {
  const min = 1_000;

  it.each([
    [0, "RUPTURE"],
    [-25, "RUPTURE"],
    [1, "CRITICAL"],
    [999, "CRITICAL"],
    [1_000, "CRITICAL"],
    [1_001, "WARNING"],
    [1_200, "WARNING"],
    [1_201, "NORMAL"],
    [50_000, "NORMAL"],
  ])("classifies a stock of %i as %s", (currentStock, expected) => {
    expect(resolveAlertLevel({ currentStock, min })).toBe(expected);
  });

  it("treats the reorder point itself as critical, not as a warning", () => {
    // Stock exactly at Min means the safety margin is fully consumed.
    expect(resolveAlertLevel({ currentStock: min, min })).toBe("CRITICAL");
  });

  it("honours a configured warning margin", () => {
    // A 50% margin gives a much earlier warning band.
    expect(resolveAlertLevel({ currentStock: 1_400, min, warningMarginRatio: 0.5 })).toBe(
      "WARNING",
    );
    expect(resolveAlertLevel({ currentStock: 1_400, min, warningMarginRatio: 0.2 })).toBe("NORMAL");
  });

  it("collapses the warning band when the margin is zero", () => {
    expect(resolveAlertLevel({ currentStock: 1_001, min, warningMarginRatio: 0 })).toBe("NORMAL");
  });

  it("reports rupture for an article with no threshold and no stock", () => {
    expect(resolveAlertLevel({ currentStock: 0, min: 0 })).toBe("RUPTURE");
  });

  it("reports normal for a non-consumed article that still holds stock", () => {
    expect(resolveAlertLevel({ currentStock: 10, min: 0 })).toBe("NORMAL");
  });

  it("rejects invalid inputs", () => {
    expect(() => resolveAlertLevel({ currentStock: Number.NaN, min })).toThrow(InvalidInputError);
    expect(() => resolveAlertLevel({ currentStock: 10, min: -1 })).toThrow(InvalidInputError);
    expect(() => resolveAlertLevel({ currentStock: 10, min, warningMarginRatio: -0.1 })).toThrow(
      InvalidInputError,
    );
  });
});

describe("alert severity ordering", () => {
  it("orders the alert board most severe first", () => {
    const board = ["NORMAL", "CRITICAL", "WARNING", "RUPTURE"] as const;
    expect([...board].sort(compareAlertSeverityDesc)).toStrictEqual([
      "RUPTURE",
      "CRITICAL",
      "WARNING",
      "NORMAL",
    ]);
  });

  it("compares severities", () => {
    expect(isAtLeastAsSevere("RUPTURE", "CRITICAL")).toBe(true);
    expect(isAtLeastAsSevere("CRITICAL", "CRITICAL")).toBe(true);
    expect(isAtLeastAsSevere("WARNING", "CRITICAL")).toBe(false);
  });
});

describe("crossedIntoShortage", () => {
  it.each([
    ["NORMAL", "CRITICAL", true],
    ["WARNING", "CRITICAL", true],
    ["NORMAL", "RUPTURE", true],
    ["CRITICAL", "RUPTURE", true],
  ] as const)("reports %s -> %s as news", (from, to, expected) => {
    expect(crossedIntoShortage(from, to)).toBe(expected);
  });

  it("says nothing when an article was already at that level", () => {
    // The case that decides whether the notification centre is usable. An
    // article sitting below its reorder point receives movements all day; one
    // notification per movement is how people learn to mute the bell.
    expect(crossedIntoShortage("CRITICAL", "CRITICAL")).toBe(false);
    expect(crossedIntoShortage("RUPTURE", "RUPTURE")).toBe(false);
  });

  it("says nothing about a recovery", () => {
    // Visible on the alert board, and not worth an interruption: telling five
    // people a problem stopped being a problem trains them to skim.
    expect(crossedIntoShortage("RUPTURE", "CRITICAL")).toBe(false);
    expect(crossedIntoShortage("CRITICAL", "WARNING")).toBe(false);
    expect(crossedIntoShortage("CRITICAL", "NORMAL")).toBe(false);
  });

  it("says nothing about a level that is not a shortage", () => {
    expect(crossedIntoShortage("NORMAL", "WARNING")).toBe(false);
    expect(crossedIntoShortage("NORMAL", "NORMAL")).toBe(false);
  });

  it("treats a first-ever level as a crossing when it is already short", () => {
    // A stock row created by its first movement has nothing to compare to. That
    // it arrived already below Min is the first thing anybody should learn.
    expect(crossedIntoShortage(null, "RUPTURE")).toBe(true);
    expect(crossedIntoShortage(null, "CRITICAL")).toBe(true);
    expect(crossedIntoShortage(null, "WARNING")).toBe(false);
    expect(crossedIntoShortage(null, "NORMAL")).toBe(false);
  });
});
