import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from this file rather than left relative: Prettier resolves a
// relative `tailwindStylesheet` against the working directory, which differs
// between running `pnpm format` at the root and running it inside a package.
const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(configDirectory, "..", "..", "..");

/**
 * Formatting is not a matter of opinion in this repository: it is applied by a
 * tool so that no diff ever contains a stylistic change.
 *
 * @type {import("prettier").Config}
 */
const config = {
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  arrowParens: "always",
  endOfLine: "lf",
  plugins: ["prettier-plugin-tailwindcss"],
  // Sorts Tailwind classes canonically; also sorts classes passed to our own
  // helpers so `cn(...)` and `cva(...)` call sites stay ordered too.
  tailwindFunctions: ["cn", "cva", "clsx", "twMerge"],
  tailwindStylesheet: path.join(repositoryRoot, "packages", "ui", "src", "styles", "globals.css"),
};

export default config;
