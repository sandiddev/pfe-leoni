import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads the repository-root `.env` for scripts run outside Next.js.
 *
 * Next.js loads `.env` itself, but the seed and the Prisma CLI do not: they are
 * plain Node processes. Pointing them at the root file rather than a copy
 * inside this package matters — a second `.env` is a second place for the
 * database password to drift, and the one that is stale is always the one
 * someone is debugging against.
 *
 * Import this module *first* in any standalone script. ES modules evaluate
 * their imports in source order, so a bare `import "./load-env"` above the
 * other imports guarantees the variables exist before `@leoni/env` validates
 * them.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");

config({ path: path.join(repositoryRoot, ".env"), quiet: true });
