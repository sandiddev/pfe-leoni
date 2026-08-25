import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query";
import superjson from "superjson";

/**
 * The HTTP status tRPC attached to an error, when it attached one.
 *
 * A narrowing function rather than a cast: `retry` receives `Error`, and the
 * `data.httpStatus` that tRPC adds is not on that type. Asserting the shape
 * would claim something no one has checked — a plain `Error` thrown by a link,
 * or a network failure, has no `data` at all.
 */
function httpStatusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("data" in error)) return null;

  const { data } = error;
  if (typeof data !== "object" || data === null || !("httpStatus" in data)) return null;

  return typeof data.httpStatus === "number" ? data.httpStatus : null;
}

/**
 * The shared React Query configuration.
 *
 * Defined once and used by both the server and the browser so that a query
 * prefetched during server rendering and the same query re-run in the browser
 * behave identically. Two configurations would mean a list that looks fresh on
 * first paint and stale a second later.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Long enough that navigating back to a screen does not refetch
        // everything, short enough that a storekeeper recording a movement sees
        // the alert board reflect it without a manual reload.
        staleTime: 30 * 1000,

        // A stock figure that is wrong is worse than one that is missing, so
        // returning to the tab revalidates.
        refetchOnWindowFocus: true,

        retry: (failureCount, error) => {
          // Never retry an authorisation failure: the answer will not change,
          // and three more attempts only delay the redirect to the login page.
          const status = httpStatusOf(error);
          if (status === 401 || status === 403 || status === 404) return false;
          return failureCount < 2;
        },
      },
      dehydrate: {
        serializeData: superjson.serialize,
        // Also send queries that are still in flight, so the browser can adopt
        // a pending server request instead of starting its own.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
      hydrate: {
        deserializeData: superjson.deserialize,
      },
    },
  });
}
