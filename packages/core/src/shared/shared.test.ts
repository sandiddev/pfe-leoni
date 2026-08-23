import { describe, expect, it } from "vitest";

import { assertNever } from "./assert-never";
import { type ArticleId, toBrandedId } from "./brand";
import { clamp, roundThreshold, roundTo } from "./rounding";

describe("assertNever", () => {
  it("throws when an unhandled union member reaches it at runtime", () => {
    // The compiler normally prevents this; the throw is the safety net for data
    // that arrives from outside the type system, such as a legacy import.
    const unexpected = "SOMETHING_NEW" as unknown as never;
    expect(() => assertNever(unexpected, "request status")).toThrow(/request status/);
  });
});

describe("toBrandedId", () => {
  it("preserves the underlying value", () => {
    const id = toBrandedId<ArticleId>("ART-0001");
    expect(id).toBe("ART-0001");
  });
});

describe("roundTo", () => {
  it("rounds to the requested precision", () => {
    expect(roundTo(3.14159, 2)).toBe(3.14);
    expect(roundTo(2.005, 2)).toBe(2.01);
  });

  it("returns zero for a non-finite value rather than propagating NaN", () => {
    // A NaN threshold would silently poison every comparison downstream.
    expect(roundTo(Number.NaN, 2)).toBe(0);
    expect(roundTo(Number.POSITIVE_INFINITY, 2)).toBe(0);
  });
});

describe("roundThreshold", () => {
  it("rounds up so a safety margin is never eroded", () => {
    expect(roundThreshold(1_499.2)).toBe(1_500);
    expect(roundThreshold(1_500)).toBe(1_500);
  });

  it("absorbs floating point drift instead of rounding it up a whole unit", () => {
    // 500 x 3 can land on 1500.0000000000002; naive ceil would return 1501.
    expect(roundThreshold(1_500.0000000000002)).toBe(1_500);
  });

  it("returns zero for a non-positive or non-finite value", () => {
    expect(roundThreshold(0)).toBe(0);
    expect(roundThreshold(-10)).toBe(0);
    expect(roundThreshold(Number.NaN)).toBe(0);
  });
});

describe("clamp", () => {
  it("confines a value to the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
