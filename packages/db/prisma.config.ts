import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

// The Prisma CLI is a plain Node process and does not load .env on its own.
// Read the repository-root file so there is only ever one copy of the
// connection string on disk.
config({ path: path.resolve(import.meta.dirname, "..", "..", ".env"), quiet: true });

/**
 * Prisma 7 reads its configuration from here rather than from the schema, so
 * the connection string never appears in a committed `.prisma` file.
 *
 * The schema is a *directory*: one file per bounded area of the domain. A
 * single 600-line schema.prisma is technically equivalent and practically
 * unreadable, and it guarantees a merge conflict every time two people touch
 * unrelated parts of the model.
 *
 * NOTE — this is the one sanctioned exception to the rule that `process.env` is
 * read only inside `@leoni/env`. This file is executed by the Prisma CLI before
 * the application exists; routing it through the full environment schema would
 * mean nobody could run a migration without first configuring the auth secrets,
 * which have nothing to do with migrating a database.
 */
const databaseUrl = process.env["DATABASE_URL"];

if (databaseUrl === undefined || databaseUrl === "") {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env at the repository root, then run `pnpm docker:up`.",
  );
}

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx src/seed.ts",
  },
  datasource: {
    url: databaseUrl,
  },
});
