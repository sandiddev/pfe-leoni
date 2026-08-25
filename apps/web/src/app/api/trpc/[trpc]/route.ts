import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";

import { appRouter, createContext } from "@leoni/api";
import { env } from "@leoni/env";

/**
 * The HTTP entry point for the API.
 *
 * Server Components bypass this and call the router in-process; this handler
 * exists for the browser. Both paths run the same router with the same context
 * factory, so an authorisation rule cannot apply on one and not the other.
 */
const isDevelopment = env.NODE_ENV === "development";

function handler(request: NextRequest): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => createContext({ headers: request.headers }),
    // Spread rather than `: undefined` — with `exactOptionalPropertyTypes` an
    // explicit `undefined` is not the same as an absent property.
    ...(isDevelopment
      ? {
          // `path?: string | undefined` rather than `path?: string`: under
          // `exactOptionalPropertyTypes` those are different types, and tRPC
          // declares the former.
          onError: ({ path, error }: { path?: string | undefined; error: Error }) => {
            console.error(`tRPC failed on ${path ?? "<no-path>"}: ${error.message}`);
          },
        }
      : {}),
  });
}

export { handler as GET, handler as POST };
