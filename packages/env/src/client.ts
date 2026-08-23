import { env } from "./server";

/**
 * The subset of the environment that is safe to reach the browser.
 *
 * Importing this rather than `./server` in client components makes the
 * boundary explicit at the import site: anything not listed here would be a
 * secret leaking into the bundle.
 */
export const clientEnv = {
  appUrl: env.NEXT_PUBLIC_APP_URL,
} as const;
