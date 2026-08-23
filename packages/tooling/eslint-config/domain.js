import { base } from "./base.js";

/**
 * Configuration for `@leoni/core` — the pure domain layer.
 *
 * The rule this file exists to enforce (brief section 6.2): the replenishment
 * formulas and the request workflow must stay independent of the UI and of
 * persistence, so they can be unit-tested in isolation and reasoned about by a
 * reader who knows logistics but not React.
 *
 * Concretely, `@leoni/core` may import *nothing*: no workspace package, no
 * Node built-in, no npm dependency. If a formula appears to need one of those,
 * the dependency belongs in the caller, passed in as a plain argument.
 */
export const domain = [
  ...base,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@leoni/*"],
              message:
                "@leoni/core is the pure domain layer and must not depend on any other workspace package. Invert the dependency: pass the value in as an argument.",
            },
            {
              group: ["@prisma/*", "next/*", "react", "react-dom", "zod"],
              message:
                "@leoni/core must stay framework-free so the business rules can be unit-tested without a database or a browser. Keep persistence and validation concerns in @leoni/db / @leoni/contracts.",
            },
          ],
          paths: [
            {
              name: "node:fs",
              message: "The domain layer performs no I/O. Read the data in the caller.",
            },
            {
              name: "node:crypto",
              message:
                "The domain layer must be deterministic so its tests are reproducible. Generate ids in the service layer and pass them in.",
            },
          ],
        },
      ],
      // A formula that reads the clock cannot be unit-tested against a fixed
      // expectation. `now` is always an explicit parameter in this package.
      // (Constructing a Date from an explicit value stays allowed — only
      // *reading the current time* is forbidden.)
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Pass `now: Date` in as a parameter (see docs/conventions.md)." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportAllDeclaration",
          message: "Re-export explicitly by name.",
        },
        {
          selector: "TSEnumDeclaration",
          message: "Use a `const` object + union type instead of `enum`.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "`new Date()` makes the domain non-deterministic. Accept `now: Date` as a parameter instead.",
        },
      ],
    },
  },
];

export default domain;
