import { library, restrictedSyntaxWithoutEnv } from "@leoni/eslint-config/library";

/**
 * `@leoni/env` is the one package allowed to read `process.env`.
 *
 * It spreads the syntax bans *without* the environment entries rather than
 * switching `no-restricted-syntax` off, which would also lose the `as`,
 * `enum` and `export *` bans here — in the package that decides what every
 * other one is allowed to see.
 */
export default [
  ...library,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSyntaxWithoutEnv],
    },
  },
];
