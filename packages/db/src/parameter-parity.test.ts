import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ABC_CLASSES, DEFAULT_CLASS_PARAMETERS } from "@leoni/core";

/**
 * The replenishment defaults live in `@leoni/core`, and the Prisma schema
 * declares column defaults for the same fields. Prisma cannot reference a
 * TypeScript value, so the two are written independently — which is exactly the
 * kind of pair that drifts.
 *
 * This test does not require them to be equal. A column default applies when
 * an INSERT omits the column, and every insert in this codebase writes all four
 * explicitly; core's defaults apply when the *row* is absent entirely. They
 * answer different questions. What must hold is that the column defaults are a
 * value some class actually uses, so a row written by hand in Adminer — or by a
 * future migration — cannot land on a combination the logistics study never
 * sanctioned.
 */

const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "schema",
  "replenishment.prisma",
);

/** Reads `fieldName Type @default(x)` out of the schema text. */
function columnDefault(field: string): number {
  const schema = readFileSync(schemaPath, "utf8");
  const match = new RegExp(`${field}\\s+Decimal\\??\\s+@default\\(([\\d.]+)\\)`).exec(schema);

  if (match?.[1] === undefined) {
    throw new Error(
      `No @default found for \`${field}\` in replenishment.prisma. If the column no longer ` +
        `carries a default, delete the corresponding case below rather than loosening the regex.`,
    );
  }

  return Number(match[1]);
}

describe("ReplenishmentParameter defaults against @leoni/core", () => {
  it("declares a default for every ABC class", () => {
    // A class with no entry would fall back to `undefined` at runtime and
    // produce NaN thresholds rather than a visible failure.
    expect(Object.keys(DEFAULT_CLASS_PARAMETERS).toSorted()).toStrictEqual([...ABC_CLASSES]);
  });

  it("keeps the class defaults ordered as the study describes them", () => {
    // Section 3.4: a fast-moving class A carries the widest safety margin and
    // the tightest restock target; class C is the reverse. If a future edit
    // inverts one of these, the numbers stay plausible and the reasoning in
    // class-parameters.ts becomes a lie.
    const { A, B, C } = DEFAULT_CLASS_PARAMETERS;

    expect(A.safetyDays).toBeGreaterThan(B.safetyDays);
    expect(B.safetyDays).toBeGreaterThan(C.safetyDays);

    expect(A.extraCoverageDays).toBeLessThan(B.extraCoverageDays);
    expect(B.extraCoverageDays).toBeLessThan(C.extraCoverageDays);
  });

  it.each(["safetyDays", "extraCoverageDays", "warningMarginRatio"] as const)(
    "has a Prisma column default for %s that some class actually uses",
    (field) => {
      const fromSchema = columnDefault(field);
      const fromCore = ABC_CLASSES.map((abcClass) => DEFAULT_CLASS_PARAMETERS[abcClass][field]);

      expect(fromCore).toContain(fromSchema);
    },
  );

  it("shares one warning margin across the classes", () => {
    // The Parameters screen can set this per class, but the *defaults* are
    // uniform, which is what lets the flat Prisma column default be honest.
    const margins = new Set(
      ABC_CLASSES.map((abcClass) => DEFAULT_CLASS_PARAMETERS[abcClass].warningMarginRatio),
    );

    expect(margins.size).toBe(1);
  });
});
