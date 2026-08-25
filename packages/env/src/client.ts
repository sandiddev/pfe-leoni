import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * The subset of the environment that is safe to reach the browser.
 *
 * This module is deliberately **standalone**: it validates the `NEXT_PUBLIC_*`
 * variables itself rather than importing `./server`. It used to re-export a
 * field off the server object, which meant any client component importing it
 * pulled the server schema — and every secret named in it — into the module
 * graph. The boundary this file claims to draw only exists if crossing it is
 * impossible, not merely discouraged.
 *
 * Anything not listed here is a secret. Adding a field is a decision to publish
 * it to every browser that loads the application.
 */
export const clientEnv = createEnv({
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
  },

  /**
   * Next.js inlines `NEXT_PUBLIC_*` at build time and does not hand the whole
   * object to the browser bundle, so each variable has to be named explicitly.
   */
  runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env["NEXT_PUBLIC_APP_URL"],
  },

  // Docker builds run without a configured environment; validation would fail
  // there for no good reason, so it is skipped explicitly rather than silently.
  skipValidation: process.env["SKIP_ENV_VALIDATION"] === "true",

  // An empty string in a .env file is a mistake, not a value.
  emptyStringAsUndefined: true,
});
