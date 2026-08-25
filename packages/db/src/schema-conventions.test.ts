import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The schema conventions, checked instead of merely described.
 *
 * `stock.prisma` opens with a comment stating the numeric convention; other
 * files state the mapping and indexing rules. Every one of those was enforced
 * by nothing, which means the next model added to this schema was free to
 * ignore them and no build would notice.
 *
 * Prisma has no plugin system and no lint hook, so this parses the schema as
 * text. That is cruder than an AST but it is honest about what it checks: each
 * assertion below points at a specific line and says what to write instead.
 *
 * These rules exist because the alternatives are all silent failures. An
 * unindexed foreign key is a sequential scan and a lock held longer than it
 * should be. An implicit `onDelete` is one of two different behaviours
 * depending on whether the relation happens to be optional. A `Float` quantity
 * is a part count that can arrive as 999.9999999.
 */

const schemaDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "schema",
);

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

interface Model {
  readonly name: string;
  readonly file: string;
  /** The model body, comments stripped. */
  readonly body: string;
  readonly lines: readonly string[];
}

function schemaFiles(): { name: string; text: string }[] {
  return readdirSync(schemaDir)
    .filter((file) => file.endsWith(".prisma"))
    .map((file) => ({ name: file, text: readFileSync(path.join(schemaDir, file), "utf8") }));
}

/** Drops `///` doc comments and `//` comments so they cannot match a rule. */
function stripComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function models(): Model[] {
  const found: Model[] = [];

  for (const { name, text } of schemaFiles()) {
    const stripped = stripComments(text);
    const pattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;

    let match = pattern.exec(stripped);
    while (match !== null) {
      const [, modelName, body] = match;
      if (modelName !== undefined && body !== undefined) {
        found.push({
          name: modelName,
          file: name,
          body,
          lines: body.split("\n").filter((line) => line.trim() !== ""),
        });
      }
      match = pattern.exec(stripped);
    }
  }

  return found;
}

const ALL_MODELS = models();

/** Field lines that declare a relation this model owns (i.e. carry the FK). */
function owningRelations(model: Model): string[] {
  return model.lines.filter((line) => line.includes("@relation") && line.includes("fields:"));
}

/** Scalar columns this model indexes, from `@@index`, `@@unique` and `@id`. */
function indexedFirstColumns(model: Model): Set<string> {
  const indexed = new Set<string>();

  // A composite index covers queries on its leading column, so only the first
  // entry counts — @@index([siteId, alertLevel]) does not help a lookup by
  // alertLevel alone.
  const pattern = /@@(?:index|unique)\(\[([^\]]+)\]/g;
  let match = pattern.exec(model.body);
  while (match !== null) {
    const first = match[1]?.split(",")[0]?.trim();
    if (first !== undefined) indexed.add(first);
    match = pattern.exec(model.body);
  }

  for (const line of model.lines) {
    if (line.includes("@id") || line.includes("@unique")) {
      const field = line.trim().split(/\s+/)[0];
      if (field !== undefined) indexed.add(field);
    }
  }

  return indexed;
}

describe("the schema declares at least one model", () => {
  it("found the schema files", () => {
    // A parser that silently matches nothing would make every test below pass.
    expect(ALL_MODELS.length).toBeGreaterThan(15);
  });
});

describe.each(ALL_MODELS.map((model) => [model.name, model] as const))(
  "model %s",
  (_name, model) => {
    it("maps to a snake_case table name", () => {
      // The database is read directly through Adminer and psql during the
      // defence; `replenishment_request_line` is legible there, `Model` is not.
      const mapping = /@@map\("([^"]+)"\)/.exec(model.body);

      expect(mapping?.[1], `${model.name} needs @@map("snake_case_name")`).toBeDefined();
      expect(mapping?.[1]).toMatch(/^[a-z][a-z0-9_]*$/);
    });

    it("gives every Decimal an explicit precision", () => {
      // Without @db.Decimal, Postgres gets `numeric(65,30)` — a column whose
      // precision nobody chose, storing a threshold nobody can compare.
      for (const line of model.lines) {
        if (!/\bDecimal\b/.test(line)) continue;
        expect(line, `${model.name}: Decimal needs @db.Decimal(p, s)`).toContain("@db.Decimal");
      }
    });

    it("uses no Float", () => {
      // Quantities are whole units (Int) and rates are Decimal. A binary float
      // makes a part count that can render as 999.9999999 and a threshold whose
      // comparison depends on the platform.
      for (const line of model.lines) {
        expect(line, `${model.name}: use Int for quantities, Decimal for rates`).not.toMatch(
          /\bFloat\b/,
        );
      }
    });

    it("declares onDelete on every relation it owns", () => {
      // Prisma's implicit default differs by optionality — Restrict for a
      // required relation, SetNull for an optional one. Writing it down is the
      // difference between a decision and a coincidence.
      //
      // Collected rather than asserted one at a time: a fail-fast loop reports
      // only the first offender per model, which turns fixing a schema into as
      // many test runs as there are mistakes.
      const missing = owningRelations(model)
        .filter((line) => !line.includes("onDelete:"))
        .map((line) => line.trim().split(/\s+/)[0] ?? "?");

      expect(missing, `${model.name}: add an explicit onDelete to ${missing.join(", ")}`).toEqual(
        [],
      );
    });

    it("indexes every foreign key it owns", () => {
      // Postgres does not index a foreign key for you. An unindexed FK means a
      // sequential scan on every join and a longer lock on every delete of the
      // parent row.
      const indexed = indexedFirstColumns(model);

      const unindexed = owningRelations(model)
        .map((line) => /fields:\s*\[([^\]]+)\]/.exec(line)?.[1]?.split(",")[0]?.trim())
        .filter((column): column is string => column !== undefined)
        .filter((column) => !indexed.has(column));

      expect(
        unindexed,
        `${model.name}: these foreign keys have no index — ${unindexed.join(", ")}. ` +
          `Add @@index([column]), or make it the leading column of an existing index.`,
      ).toEqual([]);
    });

    it("records when the row was created", () => {
      // Every table is either mutable (createdAt/updatedAt) or an append-only
      // journal (occurredAt, computedAt, snapshotDate). What none of them may be
      // is undated: the KPIs in section 6.5 are all questions about time.
      expect(
        /\b(createdAt|occurredAt|computedAt|snapshotDate)\b/.test(model.body),
        `${model.name} has no creation timestamp`,
      ).toBe(true);
    });
  },
);

describe("migrations", () => {
  const entries = readdirSync(migrationsDir, { withFileTypes: true });

  it("keeps the provider lock committed and on postgresql", () => {
    const lock = readFileSync(path.join(migrationsDir, "migration_lock.toml"), "utf8");
    expect(lock).toContain('provider = "postgresql"');
  });

  it("names every migration <timestamp>_<snake_case>", () => {
    // Prisma applies migrations in lexicographic order, which is only
    // chronological because of the timestamp prefix. A hand-named directory
    // sorts wrongly and applies out of order.
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      expect(entry.name, `migration "${entry.name}" is misnamed`).toMatch(
        /^\d{14}_[a-z0-9]+(_[a-z0-9]+)*$/,
      );
    }
  });

  it("gives every migration directory a migration.sql", () => {
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const files = readdirSync(path.join(migrationsDir, entry.name));
      expect(files, `${entry.name} has no migration.sql`).toContain("migration.sql");
    }
  });

  it("has at least one migration", () => {
    expect(entries.filter((candidate) => candidate.isDirectory()).length).toBeGreaterThan(0);
  });
});
