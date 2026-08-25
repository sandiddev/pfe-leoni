import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The trail is the deliverable, so it is checked rather than remembered.
 *
 * CLAUDE.md states the rule twice and `article.repository.ts` demonstrates it,
 * but a new `request.repository.ts` that updates a status and forgets its
 * `RequestStatusHistory` row breaks no type and no lint rule. It produces a
 * workflow that looks complete and a history with holes — and a history with
 * holes is worse than none, because it gets trusted.
 *
 * The check works on **spans**, not on whether the file happens to contain the
 * word `$transaction` somewhere. The first version of this test did the latter
 * and passed when the audited write was demoted to `Promise.all`, because an
 * unrelated `$transaction` in the same file kept it happy — a check that cannot
 * fail for its own reason is worse than no check.
 *
 * It remains a heuristic: it proves the mutation sits inside a transaction that
 * also writes the trail, not that the row's contents are right. What it catches
 * is "wrote the row, forgot the trail", which is the mistake that actually
 * happens under time pressure.
 */

const modulesDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Prisma models whose mutation must be accompanied by a trail, and the model
 * that records it.
 */
const AUDITED_MODELS = [
  { written: "replenishmentRequest", trail: "requestStatusHistory" },
  { written: "stockItem", trail: "stockMovement" },
  { written: "stockLot", trail: "stockMovement" },
  { written: "article", trail: "auditLog" },
  { written: "replenishmentParameter", trail: "auditLog" },
] as const;

const MUTATIONS = "update|updateMany|create|createMany|delete|deleteMany|upsert";

interface Repository {
  readonly feature: string;
  readonly file: string;
  readonly source: string;
}

function repositories(): Repository[] {
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      feature: entry.name,
      file: `${entry.name}.repository.ts`,
      source: readFileSync(
        path.join(modulesDir, entry.name, `${entry.name}.repository.ts`),
        "utf8",
      ),
    }));
}

const REPOSITORIES = repositories();

interface Span {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * The source range of every `$transaction(...)` call, by matching parentheses.
 *
 * A regex cannot do this: the argument is an array or a callback containing
 * arbitrarily nested calls, and `[^)]*` stops at the first inner `)`.
 */
function transactionSpans(source: string): Span[] {
  const spans: Span[] = [];
  const marker = "$transaction(";

  let from = source.indexOf(marker);
  while (from !== -1) {
    let depth = 0;
    let index = from + marker.length - 1;

    for (; index < source.length; index += 1) {
      const character = source[index];
      if (character === "(") depth += 1;
      if (character === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    spans.push({ start: from, end: index, text: source.slice(from, index) });
    from = source.indexOf(marker, index);
  }

  return spans;
}

/** Offsets of every mutating call on `db.<model>`. */
function mutationOffsets(source: string, model: string): { offset: number; call: string }[] {
  const found: { offset: number; call: string }[] = [];
  const pattern = new RegExp(`db\\.${model}\\.(${MUTATIONS})\\b`, "g");

  let match = pattern.exec(source);
  while (match !== null) {
    found.push({ offset: match.index, call: match[0] });
    match = pattern.exec(source);
  }

  return found;
}

describe("audited writes (CLAUDE.md section 3, docs/business-rules.md section 5)", () => {
  it("found the repositories", () => {
    expect(REPOSITORIES.length).toBeGreaterThan(0);
  });

  it.each(REPOSITORIES.map((repository) => [repository.feature, repository] as const))(
    "%s writes its trail inside the same transaction as the row",
    (_feature, repository) => {
      const spans = transactionSpans(repository.source);
      const offenders: string[] = [];

      for (const { written, trail } of AUDITED_MODELS) {
        for (const { offset, call } of mutationOffsets(repository.source, written)) {
          const enclosing = spans.find((span) => offset > span.start && offset < span.end);

          if (enclosing === undefined) {
            offenders.push(
              `${call} is not inside a $transaction — the ${trail} row must be written ` +
                `atomically with it, or the trail can lose a change that succeeded.`,
            );
            continue;
          }

          if (!enclosing.text.includes(`db.${trail}.`)) {
            offenders.push(
              `${call} runs in a transaction that never writes db.${trail} — ` +
                `a change with no trail is the process this project replaces.`,
            );
          }
        }
      }

      expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
    },
  );
});
