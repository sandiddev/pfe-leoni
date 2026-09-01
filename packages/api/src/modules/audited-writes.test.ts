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
 * Prisma models whose mutation must be accompanied by a trail, and the models
 * that count as one.
 *
 * `stockItem` accepts two, because it carries two independent kinds of fact and
 * they are explained by different tables: a change to `currentStock` is
 * explained by the `StockMovement` that caused it, and a change to the
 * thresholds is explained by the `ThresholdHistory` row that records the inputs
 * they were computed from. Demanding a movement for a recalculation would push
 * the parameter module into inventing a movement that never physically
 * happened, which is a worse journal than none.
 */
const AUDITED_MODELS = [
  { written: "replenishmentRequest", trails: ["requestStatusHistory"] },
  { written: "stockItem", trails: ["stockMovement", "thresholdHistory"] },
  { written: "stockLot", trails: ["stockMovement"] },
  { written: "article", trails: ["auditLog"] },
  { written: "replenishmentParameter", trails: ["auditLog"] },
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

/**
 * Functions allowed to mutate an audited model without writing its trail.
 *
 * Named explicitly rather than recognised by a pattern, and that is the whole
 * design: a new repository method is guarded by default, and exempting one is
 * a visible edit to this list with a reason beside it. The first attempt at
 * this used a content heuristic — "skip the span unless it mentions `status:`"
 * — which silently exempted `applyTransition` too, because the literal lives
 * in a helper it calls. A check that stops firing for its own reasons is worse
 * than no check, so it was replaced with this.
 *
 * Each entry states why the invariant does not apply, not why it is
 * inconvenient.
 */
const EXEMPT_FUNCTIONS = new Map([
  [
    "updateDraft",
    "Corrects a draft's lines before submission. Changes no status, so there is no status change to record.",
  ],
  [
    "deleteDraft",
    "Removes a draft that never entered the process. Its history rows go with it through onDelete: Cascade, so no half-state can exist.",
  ],
]);

/**
 * The name of the function a source offset sits inside.
 *
 * The nearest preceding `function <name>(`, which is enough here because a
 * repository is a flat list of exported functions with no nesting.
 */
function enclosingFunction(source: string, offset: number): string {
  const declarations = [...source.slice(0, offset).matchAll(/function\s+(\w+)\s*\(/g)];
  return declarations.at(-1)?.[1] ?? "";
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

  it("still fires when a trail is removed from a guarded write", () => {
    // The check that checks the check. An exemption list is one edit away from
    // exempting everything, and the previous version of this rule did exactly
    // that without anybody noticing — so the rule is exercised against a
    // deliberately broken repository rather than trusted.
    const broken = `
      export async function applyTransition(options: Options): Promise<void> {
        await db.$transaction([
          db.replenishmentRequest.update({ where: { id: options.id }, data: { status: "X" } }),
        ]);
      }
    `;

    const spans = transactionSpans(broken);
    const [mutation] = mutationOffsets(broken, "replenishmentRequest");

    expect(mutation).toBeDefined();
    expect(enclosingFunction(broken, mutation?.offset ?? 0)).toBe("applyTransition");
    expect(EXEMPT_FUNCTIONS.has("applyTransition")).toBe(false);
    expect(spans.some((span) => span.text.includes("db.requestStatusHistory."))).toBe(false);
  });

  it("documents a reason for every exemption", () => {
    for (const [name, reason] of EXEMPT_FUNCTIONS) {
      expect(reason.length, `${name} is exempt with no stated reason`).toBeGreaterThan(40);
    }
  });

  it.each(REPOSITORIES.map((repository) => [repository.feature, repository] as const))(
    "%s writes its trail inside the same transaction as the row",
    (_feature, repository) => {
      const spans = transactionSpans(repository.source);
      const offenders: string[] = [];

      for (const { written, trails } of AUDITED_MODELS) {
        const named = trails.join(" or ");

        for (const { offset, call } of mutationOffsets(repository.source, written)) {
          const owner = enclosingFunction(repository.source, offset);
          if (EXEMPT_FUNCTIONS.has(owner)) continue;

          const enclosing = spans.find((span) => offset > span.start && offset < span.end);

          if (enclosing === undefined) {
            offenders.push(
              `${call} is not inside a $transaction — the ${named} row must be written ` +
                `atomically with it, or the trail can lose a change that succeeded.`,
            );
            continue;
          }

          if (!trails.some((trail) => enclosing.text.includes(`db.${trail}.`))) {
            offenders.push(
              `${call} runs in a transaction that never writes db.${named} — ` +
                `a change with no trail is the process this project replaces.`,
            );
          }
        }
      }

      expect(offenders, `\n${offenders.join("\n")}`).toEqual([]);
    },
  );
});
