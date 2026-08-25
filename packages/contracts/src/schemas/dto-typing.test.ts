import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as core from "@leoni/core";

/**
 * DTO fields must carry their union, not `string`.
 *
 * `StockMovementItem.type` and `ThresholdHistoryPoint.trigger` were both typed
 * `string`, because `@leoni/contracts` may not import the generated Prisma
 * client and `@leoni/core` had no union to offer. The consequence surfaces one
 * layer away: `MOVEMENT_TYPE_LABELS_FR` is keyed by the union, so the first
 * component to render a movement label needs a cast — the exact thing
 * docs/conventions.md bans. A widened DTO field exports that problem to every
 * screen that consumes it.
 *
 * The check is a heuristic and deliberately narrow: it looks at field *names*
 * that name a domain concept, since those are the ones with a union available.
 * A field genuinely holding free text (`reference`, `designation`, `note`) is
 * `string` and should be.
 */

const schemasDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Field names that describe a closed set, mapped to the core export that holds
 * it. Add a row when a new union arrives; the test below proves each one exists.
 */
const UNION_FIELDS: Readonly<Record<string, string>> = {
  abcClass: "ABC_CLASSES",
  alertLevel: "ALERT_LEVELS",
  level: "ALERT_LEVELS",
  movementType: "MOVEMENT_TYPES",
  priority: "REQUEST_PRIORITIES",
  role: "ROLES",
  siteType: "SITE_TYPES",
  status: "REQUEST_STATUSES",
  trigger: "RECALCULATION_TRIGGERS",
  type: "MOVEMENT_TYPES",
};

interface Field {
  readonly file: string;
  readonly name: string;
  readonly line: string;
}

function declaredFields(): Field[] {
  const fields: Field[] = [];

  for (const file of readdirSync(schemasDir).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  )) {
    const text = readFileSync(path.join(schemasDir, file), "utf8");

    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("*") || line.startsWith("//")) continue;

      // `readonly name: type;`, plus the `readonly name: {` opener so a
      // multi-line inline literal cannot slip past the check below.
      const match = /^readonly\s+(\w+)\??:\s*(.+?)[;{]$/.exec(line);
      const name = match?.[1];
      if (name === undefined) continue;

      fields.push({ file, name, line });
    }
  }

  return fields;
}

const FIELDS = declaredFields();

describe("DTO field typing", () => {
  it("found the DTO declarations", () => {
    expect(FIELDS.length).toBeGreaterThan(20);
  });

  it("names a union that @leoni/core actually exports", () => {
    // Guards the table above from naming a union that has been renamed away.
    for (const exportName of Object.values(UNION_FIELDS)) {
      expect(exportName in core, `@leoni/core no longer exports ${exportName}`).toBe(true);
    }
  });

  it("never widens a domain concept to `string`", () => {
    const widened = FIELDS.filter((field) => {
      const union = UNION_FIELDS[field.name];
      if (union === undefined) return false;

      // `string`, `string | null`, `readonly string[]` — any shape whose only
      // named type is the bare primitive.
      return /:\s*(readonly\s+)?string(\s*\[\])?(\s*\|\s*null)?;$/.test(field.line);
    });

    expect(
      widened.map((field) => `${field.file}: ${field.line}`),
      "these DTO fields name a domain concept but are typed `string`. Use the union from " +
        "@leoni/core so the French label maps can be indexed without a cast.",
    ).toEqual([]);
  });

  it("uses no `any`, and no inline object literal, in a DTO field", () => {
    // An inline `{ ... }` in a DTO is a shape with no name, so nothing else can
    // refer to it — the UI ends up re-declaring it by hand, and the two copies
    // drift. `ArticleDetail.legacyThresholds` was one, now
    // `LegacyThresholdComparison`.
    const bad = FIELDS.filter((field) => /:\s*(any\b|\{$)/.test(field.line));

    expect(
      bad.map((field) => `${field.file}: ${field.line}`),
      "give the shape a named interface",
    ).toEqual([]);
  });
});
