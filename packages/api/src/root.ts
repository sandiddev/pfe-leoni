import { adminRouter } from "./modules/admin/admin.router";
import { alertRouter } from "./modules/alert/alert.router";
import { articleRouter } from "./modules/article/article.router";
import { dashboardRouter } from "./modules/dashboard/dashboard.router";
import { notificationRouter } from "./modules/notification/notification.router";
import { parameterRouter } from "./modules/parameter/parameter.router";
import { referentialRouter } from "./modules/referential/referential.router";
import { requestRouter } from "./modules/request/request.router";
import { stockRouter } from "./modules/stock/stock.router";
import { createCallerFactory, createTRPCRouter, protectedProcedure, publicProcedure } from "./trpc";

/**
 * The application router.
 *
 * Each namespace below is one feature module, laid out as
 * `router -> service -> repository -> mapper`. `article` is the reference
 * implementation and every other module is a copy of its four files, not a new
 * arrangement — `module-structure.test.ts` checks that it stayed that way.
 *
 * One module from section 6.1 is deliberately not here: `import`, the CSV
 * ingestion of the LEONI article export. The seed provides the demo catalogue,
 * and a parser for a spreadsheet nobody has supplied yet would be guesswork.
 */
export const appRouter = createTRPCRouter({
  admin: adminRouter,
  alert: alertRouter,
  article: articleRouter,
  dashboard: dashboardRouter,
  notification: notificationRouter,
  parameter: parameterRouter,
  referential: referentialRouter,
  request: requestRouter,
  stock: stockRouter,

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
