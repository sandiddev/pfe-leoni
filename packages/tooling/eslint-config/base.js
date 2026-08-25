import js from "@eslint/js";
import importX from "eslint-plugin-import-x";
import perfectionist from "eslint-plugin-perfectionist";
import tseslint from "typescript-eslint";

/**
 * Rules that apply to every package in the monorepo.
 *
 * Philosophy: a rule earns its place here only if breaking it produces a real
 * defect or a real inconsistency. We do not lint for taste. Anything Prettier
 * can decide is left to Prettier.
 */
const ENV_MESSAGE =
  "Read the environment through `@leoni/env` (`import { env } from '@leoni/env'`), which " +
  "validates it at boot, so a missing or malformed variable stops the process instead of " +
  "surfacing at the first request that needs it. See docs/adr/0005-no-per-package-env-files.md.";

/**
 * `process.env` reads, banned outside `@leoni/env`.
 *
 * Split out from the list below so that `@leoni/env` itself — the one package
 * whose job is to read them — can spread `restrictedSyntaxWithoutEnv` instead
 * of disabling the whole rule and losing the `as` and `enum` bans with it.
 *
 * `NODE_ENV` is exempt: Next.js inlines it at build time as a constant, and
 * t3-env structurally cannot hand a non-`NEXT_PUBLIC_` variable to a browser,
 * so a client component has no other way to ask.
 */
export const noProcessEnv = [
  {
    selector:
      'MemberExpression[object.object.name="process"][object.property.name="env"][computed=false][property.name!="NODE_ENV"]',
    message: ENV_MESSAGE,
  },
  {
    selector:
      'MemberExpression[object.object.name="process"][object.property.name="env"][computed=true][property.value!="NODE_ENV"]',
    message: ENV_MESSAGE,
  },
];

/**
 * Syntax bans that apply everywhere except where the environment is read.
 *
 * Exported as an array because ESLint's flat config *replaces* a rule's options
 * rather than merging them: a package config that declares its own
 * `no-restricted-syntax` silently drops every entry here. Every config in this
 * directory therefore spreads this list into its own. Getting that wrong is
 * invisible — the rule still exists, it just stops covering the code that
 * needed it most, which is exactly what happened to the `as` ban.
 */
export const restrictedSyntaxWithoutEnv = [
  {
    selector: "ExportAllDeclaration",
    message:
      "Barrel re-exports (`export *`) hide a package's public API. Re-export explicitly: `export { thing } from './thing'`.",
  },
  {
    selector: "TSEnumDeclaration",
    message:
      "Do not use TypeScript `enum`. Use a `const` object + union type, or the Prisma-generated enum. See docs/conventions.md.",
  },
  {
    // Everything except `as const` and the always-safe widening to `unknown`.
    // A cast is a claim the compiler cannot verify, and the ones this codebase
    // had were describing a shape that did not exist (`globalThis as ...`) and
    // a payload that might not (`error as ...`).
    //
    // Reach for `satisfies` to check a value against a type while keeping its
    // inference, or narrow with a type guard. The one sanctioned exception is
    // `toBrandedId` in @leoni/core, which disables this rule in place: a brand
    // is a phantom type with nothing to check at runtime.
    selector:
      'TSAsExpression[typeAnnotation.typeName.name!="const"][typeAnnotation.type!="TSUnknownKeyword"]',
    message:
      "`as` is banned (docs/conventions.md). Use `satisfies` to check a value against a type, or narrow with a type guard. `as const` and `as unknown` remain available.",
  },
];

/** The full list. What every package except `@leoni/env` should spread. */
export const restrictedSyntax = [...restrictedSyntaxWithoutEnv, ...noProcessEnv];

export const base = tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/src/generated/**",
      "**/*.config.js",
      "**/*.config.mjs",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Type-aware linting across the whole workspace. This is what makes the
        // rules below able to reason about types instead of just syntax.
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      "import-x": importX,
      perfectionist,
    },
    rules: {
      // --- The type-safety rules that matter ------------------------------
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      // `import type { X }` rather than `import { type X }`.
      //
      // This is not a style preference. With `verbatimModuleSyntax`, an import
      // whose specifiers are ALL inline-type still emits `import {} from "mod"`
      // — a side-effect import that loads the module at runtime. A client
      // component importing only a type from a server module would therefore
      // pull the server module, and everything it imports, into the browser
      // bundle. The `import type` form is erased completely.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Floating promises are the single most common source of silent data
      // loss in a Prisma/tRPC codebase. Never a warning.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/return-await": ["error", "in-try-catch"],

      // `as` is banned; `satisfies` keeps the check while preserving inference.
      //
      // `consistent-type-assertions` alone does NOT express this: with
      // `objectLiteralTypeAssertions: "never"` it rejects only a cast applied
      // to an object literal, so `value as SomeType` passed freely. Three such
      // casts had accumulated, one of them a claim that was simply wrong. The
      // ban itself is the `no-restricted-syntax` entry below.
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],

      // --- Module hygiene --------------------------------------------------
      // Default exports make a symbol renameable at every import site, which
      // defeats grep and refactoring. Next.js files opt back in explicitly.
      "import-x/no-default-export": "error",
      "import-x/no-cycle": ["error", { maxDepth: 6 }],
      "import-x/no-self-import": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-useless-path-segments": ["error", { noUselessIndex: true }],

      "no-restricted-syntax": ["error", ...restrictedSyntax],

      // CLAUDE.md section 5. A function past this length is doing more than one
      // thing, and a fifth parameter is a parameter object waiting to happen —
      // every domain function already takes one, which is why their call sites
      // read without checking the signature.
      "max-lines-per-function": [
        "error",
        { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      "max-params": ["error", 4],

      // --- Correctness ------------------------------------------------------
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-param-reassign": ["error", { props: true }],

      // --- Ordering (auto-fixable, zero judgement required) -----------------
      "perfectionist/sort-imports": [
        "error",
        {
          type: "natural",
          newlinesBetween: 1,
          groups: [
            ["builtin", "external"],
            "internal",
            ["parent", "sibling", "index"],
            "style",
            "unknown",
          ],
          customGroups: [{ groupName: "internal", elementNamePattern: "^@leoni/.*" }],
        },
      ],
      "perfectionist/sort-named-imports": ["error", { type: "natural" }],
    },
  },

  // Config and script files are allowed a default export and console output.
  //
  // They may also read `process.env` directly: each one runs *before* the
  // validated environment can exist. `prisma.config.ts` is loaded by the Prisma
  // CLI, `next.config.ts` before Next evaluates anything, and `seed.ts` is a
  // plain Node process that has to populate the variables it then validates.
  // Each of these already carries a comment saying so in place.
  {
    files: [
      "**/*.config.ts",
      "**/*.config.mts",
      "**/*.config.mjs",
      "**/scripts/**",
      "**/src/seed.ts",
    ],
    rules: {
      "import-x/no-default-export": "off",
      "no-console": "off",
      "no-restricted-syntax": [
        "error",
        { selector: "ExportAllDeclaration", message: "Re-export explicitly by name." },
        { selector: "TSEnumDeclaration", message: "Use a `const` object + union type." },
      ],
      // A seed builds a whole demo database; splitting `main` into sixty-line
      // pieces would scatter one linear narrative across a dozen helpers.
      "max-lines-per-function": "off",
    },
  },

  // Tests may use non-null assertions and unsafe casts to build fixtures.
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/__tests__/**", "**/e2e/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      // A stub standing in for an async repository method is declared `async`
      // to match the signature it replaces, and has nothing to await. That is
      // the correct shape, not an oversight. `no-floating-promises` stays on,
      // so a test that forgets to await a real promise is still caught.
      "@typescript-eslint/require-await": "off",
      "no-console": "off",
      // A `describe` block is a list of cases, not a function doing work.
      "max-lines-per-function": "off",
    },
  },

  // A component's length is mostly JSX, and this rule counts markup lines as
  // though they were branches. `max-params` still applies — a component with
  // five positional parameters is a props object waiting to happen — and the
  // rules that measure actual complexity (`complexity`,
  // `no-unnecessary-condition`) are unaffected. Reviewing component size stays
  // a judgement call rather than a line count.
  {
    files: ["**/*.tsx"],
    rules: {
      "max-lines-per-function": "off",
    },
  },
);

export default base;
