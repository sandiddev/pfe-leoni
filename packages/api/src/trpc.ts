import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod";

import {
  BusinessRuleError,
  can,
  ForbiddenActionError,
  InvalidInputError,
  isDomainError,
  type Permission,
  type Role,
  TransitionNotAllowedError,
} from "@leoni/core";

import type { Context } from "./context";

/**
 * tRPC initialisation and the procedure builders every module uses.
 *
 * `superjson` is the transformer because the DTOs carry `Date` objects and
 * `null`s that plain JSON would flatten into strings. A `receivedAt` that
 * arrives in the browser as a string is a date comparison waiting to be wrong.
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,

  /**
   * Translates errors into something the client can act on.
   *
   * The domain layer throws `DomainError` subclasses and knows nothing about
   * HTTP; this is the single place that decides what each one means over the
   * wire. Keeping the mapping here rather than in each router is what lets a
   * new rule be added to `@leoni/core` without touching the transport, and
   * guarantees that the same violation always produces the same status.
   */
  errorFormatter({ shape, error }) {
    const cause = error.cause;

    return {
      ...shape,
      data: {
        ...shape.data,
        // Field-level messages for react-hook-form to attach to inputs.
        // `treeifyError` is the Zod 4 replacement for the removed `flatten()`.
        zodError: cause instanceof ZodError ? z.treeifyError(cause) : null,
        // The stable domain code, so the UI can branch on the rule that was
        // broken rather than on a translated message.
        domainCode: isDomainError(cause) ? cause.code : null,
        domainDetails: isDomainError(cause) ? cause.details : null,
      },
    };
  },
});

/**
 * Converts a domain error into the matching tRPC error.
 *
 * Anything that is not a recognised domain error is deliberately *not*
 * inspected: an unexpected failure must surface as INTERNAL_SERVER_ERROR with
 * its message withheld, rather than leaking a Prisma constraint name or a
 * connection string into a browser.
 */
function toTRPCError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;

  if (error instanceof ForbiddenActionError) {
    return new TRPCError({ code: "FORBIDDEN", message: error.message, cause: error });
  }
  if (error instanceof TransitionNotAllowedError) {
    // The request is well-formed; it is the current state that forbids it.
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }
  if (error instanceof InvalidInputError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (error instanceof BusinessRuleError) {
    return new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: error.message, cause: error });
  }

  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: error });
}

const domainErrorMiddleware = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    throw toTRPCError(error);
  }
});

const requireSession = t.middleware(({ ctx, next }) => {
  if (ctx.actor === null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Vous devez etre connecte pour effectuer cette action.",
    });
  }

  // Narrowed for every downstream procedure: `ctx.actor` is non-null from here.
  return next({ ctx: { ...ctx, actor: ctx.actor } });
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const middleware = t.middleware;

/** Open to anyone. Used only by the health check and the session probe. */
export const publicProcedure = t.procedure.use(domainErrorMiddleware);

/** Requires an authenticated, active user. */
export const protectedProcedure = publicProcedure.use(requireSession);

/**
 * Requires a specific permission.
 *
 * Procedures declare the permission they need rather than the roles they
 * accept, so "who may approve a request" stays a single statement in
 * `@leoni/core/access` instead of a list repeated at every call site and
 * updated in four of the five places when the process changes.
 */
export function permissionProcedure(permission: Permission) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!can(ctx.actor.role, permission)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Votre role (${ctx.actor.role}) ne permet pas cette action.`,
      });
    }
    return next({ ctx });
  });
}

/**
 * Requires one of a set of roles.
 *
 * Prefer `permissionProcedure`. This exists for the handful of operations that
 * are genuinely about *who you are* rather than what you may do — for example
 * an LTN4-only preparation queue.
 */
export function roleProcedure(...roles: readonly Role[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!roles.includes(ctx.actor.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Votre role (${ctx.actor.role}) ne permet pas cette action.`,
      });
    }
    return next({ ctx });
  });
}
