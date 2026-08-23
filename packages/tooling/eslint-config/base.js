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
      // `as const` and casts to `unknown`/`never` remain available.
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

      // `export *` hides the public surface of a package and breaks
      // tree-shaking analysis. Re-export explicitly by name.
      "no-restricted-syntax": [
        "error",
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
      ],

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
  {
    files: ["**/*.config.ts", "**/*.config.mts", "**/scripts/**", "**/src/seed.ts"],
    rules: {
      "import-x/no-default-export": "off",
      "no-console": "off",
    },
  },

  // Tests may use non-null assertions and unsafe casts to build fixtures.
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/__tests__/**", "**/e2e/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "no-console": "off",
    },
  },
);

export default base;
