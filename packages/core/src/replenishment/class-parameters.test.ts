import { describe, expect, it } from "vitest";

import { ABC_CLASSES } from "./abc-class";
import { DEFAULT_WARNING_MARGIN_RATIO } from "./alert-level";
import { DEFAULT_CLASS_PARAMETERS, defaultParametersForClass } from "./class-parameters";
import { computeThresholds } from "./thresholds";

describe("DEFAULT_CLASS_PARAMETERS (brief section 3.4)", () => {
  it("reproduces the values the study specifies", () => {
    // Written out rather than derived, because these exact numbers are quoted
    // in the report: a change here has to be a deliberate edit to a test that
    // says so, not a silent consequence of refactoring.
    expect(DEFAULT_CLASS_PARAMETERS.A.safetyDays).toBe(2);
    expect(DEFAULT_CLASS_PARAMETERS.A.extraCoverageDays).toBe(3);
    expect(DEFAULT_CLASS_PARAMETERS.B.safetyDays).toBe(1.5);
    expect(DEFAULT_CLASS_PARAMETERS.B.extraCoverageDays).toBe(5);
    expect(DEFAULT_CLASS_PARAMETERS.C.safetyDays).toBe(1);
    expect(DEFAULT_CLASS_PARAMETERS.C.extraCoverageDays).toBe(10);
  });

  it("covers every ABC class, so no lookup can miss", () => {
    for (const abcClass of ABC_CLASSES) {
      expect(defaultParametersForClass(abcClass)).toBeDefined();
    }
  });

  it("uses the shared warning margin rather than restating it", () => {
    for (const abcClass of ABC_CLASSES) {
      expect(defaultParametersForClass(abcClass).warningMarginRatio).toBe(
        DEFAULT_WARNING_MARGIN_RATIO,
      );
    }
  });

  it("offers an averaging window the domain actually supports", () => {
    for (const abcClass of ABC_CLASSES) {
      expect([7, 30, 90]).toContain(defaultParametersForClass(abcClass).averagingWindowDays);
    }
  });

  it("produces usable thresholds for every class at the same consumption", () => {
    // The property that matters is the invariant, at every class: a fast mover
    // must trigger earlier than a slow one, and Max must always exceed Min.
    const consumption = 100;
    const leadTimeDays = 2;

    const byClass = ABC_CLASSES.map((abcClass) => {
      const parameters = defaultParametersForClass(abcClass);
      return {
        abcClass,
        ...computeThresholds({
          averageDailyConsumption: consumption,
          leadTimeDays,
          safetyDays: parameters.safetyDays,
          extraCoverageDays: parameters.extraCoverageDays,
        }),
      };
    });

    for (const thresholds of byClass) {
      expect(thresholds.safetyStock).toBeLessThanOrEqual(thresholds.min);
      expect(thresholds.min).toBeLessThan(thresholds.max);
    }

    // Class A reorders earliest (widest safety margin) …
    const [classA, classB, classC] = byClass;
    expect(classA?.min).toBeGreaterThan(classB?.min ?? 0);
    expect(classB?.min).toBeGreaterThan(classC?.min ?? 0);

    // … and restocks to the lowest ceiling, so fast movers do not tie up space.
    expect(classA?.max).toBeLessThan(classC?.max ?? 0);
  });
});
