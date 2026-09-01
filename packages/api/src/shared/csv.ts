import Papa from "papaparse";

/**
 * Reading a spreadsheet export.
 *
 * `papaparse` rather than a hand-rolled split, and it was already chosen: the
 * version sits in `pnpm-workspace.yaml` under `catalog:`, declared for this
 * feature and never installed. CSV looks like `split(",")` until a designation
 * contains a comma, or a quoted field contains a newline, or the file arrives
 * with a UTF-8 BOM from Excel — all of which a real LEONI export will do, and
 * all of which are somebody else's solved problem.
 *
 * Deliberately *not* in `@leoni/core`: the domain imports nothing, and parsing
 * a file format is not a business rule. Deliberately not in the route handler
 * either, where no service test could reach it.
 */

export interface CsvTable {
  /** Header names, trimmed, in file order. */
  readonly headers: readonly string[];
  /** One record per data row, keyed by header. Blank lines are dropped. */
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/**
 * Parses a CSV document into records keyed by header.
 *
 * Every value comes back as a string. Papa can coerce types itself and is told
 * not to: `dynamicTyping` turns a reference like `00123` into the number 123
 * and an empty cell into `null`, which silently rewrites the data before any
 * schema gets to refuse it. The Zod row schema does the coercion, where the
 * failure is reportable against a line number.
 *
 * `delimiter` is auto-detected, because a French Excel writes `;` rather than
 * `,` and the person exporting the file has no idea that is happening.
 */
export function parseCsv(content: string): CsvTable {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
    // Strips the BOM Excel puts at the front, which otherwise becomes part of
    // the first header name and makes that column silently unmatchable.
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
    transform: (value) => value.trim(),
  });

  return {
    headers: parsed.meta.fields ?? [],
    rows: parsed.data,
  };
}
