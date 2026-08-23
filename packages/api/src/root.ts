import { articleRouter } from "./modules/article/article.router";
import { createCallerFactory, createTRPCRouter, protectedProcedure, publicProcedure } from "./trpc";

/**
 * The application router.
 *
 * Each namespace below is one feature module, laid out as
 * `router -> service -> repository -> mapper`. `article` is complete and is the
 * reference implementation; the remaining modules are added by copying its
 * four files rather than by inventing a new arrangement.
 *
 * Modules still to build (brief section 6.1):
 *   stock         movements, adjustments, per-location stock, FIFO
 *   alert         the computed alert board
 *   request       the replenishment workflow
 *   parameter     ABC defaults, averaging window, threshold recalculation
 *   dashboard     KPIs and exports
 *   notification  the in-app notification centre
 *   admin         users, roles, audit log
 *   import        CSV ingestion of the LEONI article export
 */
export const appRouter = createTRPCRouter({
  article: articleRouter,

  /**
   * Liveness probe. Public on purpose: it is what a deployment check calls
   * before any user exists, and it deliberately reveals nothing but the fact
   * that the process is answering.
   */
  health: createTRPCRouter({
    ping: publicProcedure.query(() => ({ status: "ok" as const })),
  }),

  /**
   * The current identity, as the server understands it.
   *
   * The client has a session cookie, but the role and plant that actually
   * govern what it may do are decided here. Screens read this rather than the
   * cookie so that a deactivated account or a changed role takes effect on the
   * next navigation instead of at the next login.
   */
  session: createTRPCRouter({
    me: protectedProcedure.query(({ ctx }) => ctx.actor),
  }),
});

export type AppRouter = typeof appRouter;

/**
 * Calls the API directly, without HTTP.
 *
 * Used by React Server Components and by the scheduled job: both run on the
 * server, and routing their calls through a network hop to the same process
 * would add latency and a serialisation round trip for nothing.
 */
export const createCaller = createCallerFactory(appRouter);
