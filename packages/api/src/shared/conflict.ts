import { ConflictError } from "@leoni/core";

/**
 * Turning a lost race into a domain error.
 *
 * Every guarded write in this package follows the same shape: the service reads
 * a row, the domain decides what the new value should be from what was read,
 * and the repository writes it back. That sequence is only correct if the row
 * has not changed in between — and two storekeepers on a shop floor are exactly
 * the case where it has.
 *
 * The guard is a `where` clause carrying the value that was read, not just the
 * id. Prisma's `update` accepts non-unique filters beside the unique key and
 * raises `P2025` when nothing matches, so the check costs no extra round trip
 * and the transaction rolls back with it. `updateMany` was the alternative and
 * is worse here: it reports a count instead of failing, which means the writer
 * has to remember to look — and the whole class of bug this prevents is a
 * writer that did not look.
 *
 * Why not `increment` / `decrement`, which need no guard at all: `alertLevel` is
 * written in the same statement and is a domain decision about the *resulting*
 * stock level. A blind atomic delta cannot compute it, so the level would drift
 * away from the quantity it summarises — trading a rare lost update for a
 * permanently untrustworthy alert board.
 */

/** Prisma's "the where clause matched no row". */
const RECORD_NOT_FOUND = "P2025";

/**
 * Recognised structurally rather than with `instanceof
 * PrismaClientKnownRequestError`.
 *
 * Two reasons. This module is not a `*.repository.ts`, so a lint rule forbids
 * it from importing `@leoni/db` at all — and that rule is right: a helper about
 * error semantics should not drag the database client into the layer graph.
 * Second, `instanceof` across two copies of the client (a generated client and
 * a re-exported one) is a false negative that only appears at runtime, and a
 * concurrency guard that silently stops recognising its own error is worse than
 * no guard.
 */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === RECORD_NOT_FOUND
  );
}

/**
 * Runs a guarded write, reporting a lost race as `ConflictError`.
 *
 * A genuinely deleted row lands here too, and sharing one error is deliberate:
 * from the caller's position both mean "the state you were shown is gone, read
 * it again", which is the same instruction. Distinguishing them would need
 * another query to ask which it was, to produce advice that does not differ.
 */
export async function guarded<T>(
  write: () => Promise<T>,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isRecordNotFound(error)) throw new ConflictError(message, details);
    throw error;
  }
}
