import { NextResponse } from "next/server";

import { ARTICLE_IMPORT_COLUMNS, ARTICLE_IMPORT_HEADERS_FR } from "@leoni/contracts";

/**
 * The model import file.
 *
 * Served by the application rather than documented in a wiki, because the
 * column contract and the file people actually fill in have to be the same
 * thing. `ARTICLE_IMPORT_COLUMNS` is the single source: add a column there and
 * this file gains it, so the model can never describe a format the importer
 * does not accept.
 *
 * The header carries the machine-readable names, because those are what the
 * importer matches on. One row of plausible data follows, so somebody opening
 * the file in Excel can see what a valid value looks like rather than inferring
 * it from a column name — the difference between `2` and `2 jours` in the lead
 * time column is the kind of thing that produces a file of validation errors.
 */

/** One row of plausible data, so the expected format is unambiguous. */
const EXAMPLE_ROW: Readonly<Record<(typeof ARTICLE_IMPORT_COLUMNS)[number], string>> = {
  reference: "BTR-10413",
  designation: "Boitier connecteur 12 voies",
  vpe: "250",
  leadTimeDays: "2",
  abcClass: "A",
  initialStock: "1000",
  siteCode: "LTN1",
};

export function GET(): NextResponse {
  const header = ARTICLE_IMPORT_COLUMNS.join(",");
  const labels = ARTICLE_IMPORT_COLUMNS.map((column) => ARTICLE_IMPORT_HEADERS_FR[column]);
  const example = ARTICLE_IMPORT_COLUMNS.map((column) => {
    const value = EXAMPLE_ROW[column];
    // Quoted when it contains the delimiter, which the designation does not
    // today and will the moment somebody writes "Boitier, 12 voies".
    return value.includes(",") ? `"${value}"` : value;
  });

  // The BOM is deliberate: without it Excel reads a UTF-8 CSV as Latin-1 and
  // renders every accent as mojibake. The importer strips it back off.
  const content = `\uFEFF${header}\n${example.join(",")}\n`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": 'attachment; filename="modele-import-articles.csv"',
      // The labels travel as a header rather than a row, so the file stays
      // machine-readable while the screen can still show what each column means.
      "X-Column-Labels": labels.join(" | "),
    },
  });
}
