import nextPlugin from "@next/eslint-plugin-next";
import tanstackQuery from "@tanstack/eslint-plugin-query";
import reactHooks from "eslint-plugin-react-hooks";

import { base, restrictedSyntax } from "./base.js";

/**
 * Configuration for `apps/web`.
 *
 * The web app composes: it renders the design system and calls the API through
 * tRPC. It owns no business rule and it never speaks to the database.
 */
export const next = [
  ...base,
  // `configs.flat.*` is the flat-config form; `configs.recommended` is still
  // the legacy eslintrc shape and ESLint 10 rejects it.
  reactHooks.configs.flat.recommended,
  // `configs.recommended` / `configs["core-web-vitals"]` are the flat-config
  // forms; the `*-legacy` variants are the old eslintrc shape ESLint 10 rejects.
  nextPlugin.configs.recommended,
  nextPlugin.configs["core-web-vitals"],
  ...tanstackQuery.configs["flat/recommended"],
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@leoni/db", "@leoni/db/*", "@prisma/client", ".prisma/*"],
              message:
                "The web app never talks to the database. Add a tRPC procedure in @leoni/api and call that.",
            },
            {
              group: ["@leoni/api/src/*", "@leoni/api/modules/*"],
              message:
                "Import only the public surface of @leoni/api (the AppRouter type and the factory). Reaching into its internals couples the UI to the service layer.",
            },
          ],
        },
      ],
      // A business rule duplicated in a component is a rule that will drift.
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}/]",
          message:
            "Raw colour literals bypass the design system. Use a semantic token from @leoni/ui.",
        },
      ],
    },
  },

  // Next.js requires a default export from these files; the framework's
  // conventions win over ours here, and only here.
  {
    files: [
      "src/app/**/page.tsx",
      "src/app/**/layout.tsx",
      "src/app/**/template.tsx",
      "src/app/**/loading.tsx",
      "src/app/**/error.tsx",
      "src/app/**/not-found.tsx",
      "src/app/**/global-error.tsx",
      "src/app/**/opengraph-image.tsx",
      // Next 16 renamed the middleware convention to `proxy.ts`.
      "src/proxy.ts",
      "src/middleware.ts",
      "next.config.ts",
    ],
    rules: { "import-x/no-default-export": "off" },
  },
];

export default next;
