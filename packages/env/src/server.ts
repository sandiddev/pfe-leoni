import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Server-side environment.
 *
 * The application refuses to start with a missing or malformed variable rather
 * than failing later, in production, at the first request that happens to need
 * it. A typo in `DATABASE_URL` should stop a deployment, not corrupt a stock
 * movement.
 *
 * This module is the ONLY place `process.env` may be read — a lint rule
 * enforces that everywhere else. Every other package imports `env` from here
 * and gets a fully typed, already-validated object.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    DATABASE_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith("postgres"), {
        message: "DATABASE_URL must be a PostgreSQL connection string.",
      }),

    /** Separate database used by integration tests. Never the dev database. */
    TEST_DATABASE_URL: z.string().optional(),

    // A short secret is a weak secret; better-auth signs session cookies with
    // this, so the length floor is a real security control, not a formality.
    BETTER_AUTH_SECRET: z
      .string()
      .min(
        32,
        "BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32",
      ),
    BETTER_AUTH_URL: z.url(),

    /** Shared secret required by the nightly threshold-recalculation endpoint. */
    JOB_SECRET: z.string().min(16),

    /** Password given to the demo accounts created by the seed. */
    SEED_USER_PASSWORD: z.string().min(8).default("Leoni2026!"),

    /**
     * Where request attachments land on the host disk.
     *
     * No external object storage (brief section 6.2): the application runs on
     * the LEONI internal network and its files stay there. A relative default
     * keeps a fresh checkout working; a deployment points this at a volume that
     * survives a redeploy.
     */
    UPLOAD_DIR: z.string().min(1).default("./uploads"),
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
  },

  /**
   * Next.js inlines the NEXT_PUBLIC_* variables at build time and does not
   * expose the whole object to the browser bundle, so client variables have to
   * be destructured explicitly here.
   */
  runtimeEnv: {
    NODE_ENV: process.env["NODE_ENV"],
    DATABASE_URL: process.env["DATABASE_URL"],
    TEST_DATABASE_URL: process.env["TEST_DATABASE_URL"],
    BETTER_AUTH_SECRET: process.env["BETTER_AUTH_SECRET"],
    BETTER_AUTH_URL: process.env["BETTER_AUTH_URL"],
    JOB_SECRET: process.env["JOB_SECRET"],
    SEED_USER_PASSWORD: process.env["SEED_USER_PASSWORD"],
    UPLOAD_DIR: process.env["UPLOAD_DIR"],
    NEXT_PUBLIC_APP_URL: process.env["NEXT_PUBLIC_APP_URL"],
  },

  // Docker builds run without a database; validation would fail there for no
  // good reason, so it is skipped explicitly rather than silently.
  skipValidation: process.env["SKIP_ENV_VALIDATION"] === "true",

  // An empty string in a .env file is a mistake, not a value.
  emptyStringAsUndefined: true,
});
