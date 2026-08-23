import reactHooks from "eslint-plugin-react-hooks";

import { base } from "./base.js";

/**
 * Configuration for `@leoni/ui` — the design system.
 *
 * The design system is deliberately ignorant of the application: it knows about
 * tokens, primitives and patterns, and nothing about replenishment. That is what
 * lets a component be reused, restyled and reviewed on its own.
 */
export const react = [
  ...base,
  // `configs.flat.*` is the flat-config form; `configs.recommended` is still
  // the legacy eslintrc shape and ESLint 10 rejects it.
  reactHooks.configs.flat.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@leoni/api", "@leoni/api/*", "@leoni/db", "@leoni/db/*", "@leoni/auth", "@leoni/auth/*", "@prisma/client"],
              message:
                "The design system must not know about the API, the database or authentication. Accept the data as props instead.",
            },
          ],
        },
      ],

      // Colour is a token decision, not a per-component decision. A raw hex or a
      // Tailwind arbitrary value here means the design system has been bypassed.
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
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}/]",
          message:
            "Raw colour literals bypass the design system. Add a semantic token in packages/ui/src/styles/tokens.css and use it (see docs/design-system.md).",
        },
        {
          selector: "Literal[value=/-\\[/]",
          message:
            "Tailwind arbitrary values bypass the design system. Use a semantic token class instead (see docs/design-system.md).",
        },
      ],
    },
  },
];

export default react;
