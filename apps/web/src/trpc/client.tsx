"use client";

import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchStreamLink, loggerLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { type ReactNode, useState } from "react";
import superjson from "superjson";

import type { AppRouter } from "@leoni/api";
import { clientEnv } from "@leoni/env/client";

import { createQueryClient } from "./query-client";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

let browserQueryClient: QueryClient | undefined;

/**
 * One query client per browser session, a new one per server render.
 *
 * On the server a shared client would leak one user's cached data into another
 * user's render — a storekeeper at LTN1 seeing LTN4's stock because a request
 * happened to be handled by the same process. In the browser there is only ever
 * one user, so the client is created once and reused; recreating it on each
 * render would throw away the cache on every navigation.
 */
function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return createQueryClient();
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}

/**
 * Where the browser should send tRPC calls.
 *
 * In the browser, the origin the page was actually served from — which keeps
 * working behind a reverse proxy or when a colleague opens the app by the
 * host's LAN address. Server-side rendering has no `window`, so it falls back
 * to the configured application URL. That used to be a hardcoded
 * `localhost:3000`, which was simply wrong: the dev server listens on 4300.
 */
function getBaseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return clientEnv.NEXT_PUBLIC_APP_URL;
}

export function TRPCReactProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = getQueryClient();

  // `useState` rather than a module constant: the client must be created during
  // render so that React can discard it correctly if the tree is thrown away.
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        loggerLink({
          // Noisy in production; invaluable when a storekeeper reports that a
          // button "did nothing".
          // `process.env.NODE_ENV` is the one sanctioned read outside @leoni/env:
          // it is a build-time constant Next.js inlines, not configuration, and
          // t3-env cannot expose a non-NEXT_PUBLIC_ variable to the browser.
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchStreamLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          headers: () => ({ "x-trpc-source": "react" }),
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
