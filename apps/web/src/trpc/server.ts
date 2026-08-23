import "server-only";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { headers } from "next/headers";
import { cache } from "react";

import { createCaller, createContext } from "@leoni/api";

import { createQueryClient } from "./query-client";

/**
 * Calling the API from React Server Components.
 *
 * Server Components run in the same process as the API, so they call it
 * directly rather than over HTTP. A fetch to `localhost` from a server
 * component would serialise the arguments, open a socket to itself, and
 * deserialise the result — all to reach a function that is already in memory.
 *
 * `server-only` at the top is a build-time guard: importing this module from a
 * client component fails the build rather than shipping the database client to
 * a browser.
 */

/**
 * `cache` deduplicates within a single request.
 *
 * One page renders many Server Components, and each of them asking for the
 * context would mean re-reading the session cookie and re-querying the user
 * once per component. Wrapping it makes the context per-request, not
 * per-component.
 */
const getContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");
  return createContext({ headers: heads });
});

export const getQueryClient = cache(createQueryClient);

/** Direct, in-process caller. Use it in Server Components and route handlers. */
export const api = createCaller(getContext);

/**
 * Query-options proxy, for prefetching on the server and hydrating in the
 * browser: a Server Component prefetches, the client component that needs the
 * same data adopts the result instead of re-fetching it on mount.
 */
export const trpc = createTRPCOptionsProxy({
  ctx: getContext,
  router: (await import("@leoni/api")).appRouter,
  queryClient: getQueryClient,
});
