import { base } from "./base.js";

/**
 * Configuration for `@leoni/api` — the application layer.
 *
 * Every feature is a vertical slice of exactly four files, and the direction of
 * dependency between them is one-way:
 *
 *     *.router.ts      validation + authorisation + orchestration
 *          |           (never contains a business rule)
 *          v
 *     *.service.ts     business rules; calls @leoni/core; owns the transaction
 *          |
 *          v
 *     *.repository.ts  the ONLY place `@leoni/db` / Prisma may be touched
 *          |
 *          v
 *     *.mapper.ts      Prisma row <-> DTO (Decimal -> number happens here)
 *
 * The point is that a reader can open `article.service.ts` and see the whole
 * business rule with no SQL in the way, and open `article.repository.ts` and
 * see the whole persistence concern with no business rule in the way.
 *
 * These rules are not documentation: a violation fails `pnpm lint`.
 *
 * They are expressed with `no-restricted-imports` rather than with an
 * architecture plugin deliberately. The layers here are *files inside one
 * module folder*, which is not the shape folder-based boundary plugins model;
 * and a rule the whole team must trust is better written in a built-in rule
 * that cannot be reshaped by a plugin's next major version. The cross-*package*
 * boundaries are enforced more strongly still — by pnpm itself, since a package
 * cannot import what its package.json does not declare.
 */

/** Applied everywhere in the package: this code never runs in a browser. */
const noClientImports = {
  group: ["@leoni/ui", "@leoni/ui/*", "react", "react-dom", "next", "next/*"],
  message: "@leoni/api is server-side only and must not depend on the UI layer.",
};

const noPrisma = {
  group: ["@leoni/db", "@leoni/db/*", "@prisma/client", "@prisma/*", ".prisma/*"],
  message:
    "Database access belongs in a `*.repository.ts` file. A service or a router must call the repository instead — that is what keeps the business rules testable without a database.",
};

export const api = [
  ...base,

  // --- Everything in the package ------------------------------------------
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noClientImports, noPrisma] }],
    },
  },

  // --- Routers: orchestrate only -------------------------------------------
  {
    files: ["src/**/*.router.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noClientImports,
            noPrisma,
            {
              group: ["**/*.repository", "**/*.repository.js", "**/*.repository.ts"],
              message:
                "A router must not reach into persistence. Call the service, which owns the rule and the transaction.",
            },
            {
              group: ["**/*.mapper", "**/*.mapper.js", "**/*.mapper.ts"],
              message:
                "A router returns whatever the service returns. Mapping a database row here would put a persistence concern in the transport layer.",
            },
          ],
        },
      ],
    },
  },

  // --- Services: business rules, no transport ------------------------------
  {
    files: ["src/**/*.service.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noClientImports,
            noPrisma,
            {
              group: ["**/*.router", "**/*.router.js", "**/*.router.ts", "**/trpc", "**/trpc.js", "**/trpc.ts"],
              message:
                "A service must not know about tRPC. Throw a DomainError from @leoni/core and let the router's error formatter translate it.",
            },
          ],
        },
      ],
    },
  },

  // --- Repositories: the sanctioned home of Prisma -------------------------
  {
    files: ["src/**/*.repository.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noClientImports,
            {
              group: [
                "**/*.service",
                "**/*.service.js",
                "**/*.service.ts",
                "**/*.router",
                "**/*.router.js",
                "**/*.router.ts",
              ],
              message:
                "A repository answers questions and records facts. It must not call back up into the layer that decides what to ask.",
            },
          ],
        },
      ],
    },
  },

  // --- Mappers: pure translation -------------------------------------------
  {
    files: ["src/**/*.mapper.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noClientImports,
            {
              group: [
                "**/*.service",
                "**/*.service.js",
                "**/*.service.ts",
                "**/*.router",
                "**/*.router.js",
                "**/*.router.ts",
              ],
              message: "A mapper translates a row into a DTO and depends on nothing else.",
            },
          ],
        },
      ],
    },
  },

  // --- The context is where the client is handed out -----------------------
  {
    files: ["src/context.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noClientImports] }],
    },
  },
];

export default api;
