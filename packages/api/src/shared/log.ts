/**
 * Structured logging for calls that failed.
 *
 * The audit tables already record what *succeeded*: `AuditLog` for master data,
 * `RequestStatusHistory` for every transition, `ThresholdHistory` for every
 * recomputation. What nothing recorded is a call that **threw** — so "the
 * shipment would not save yesterday afternoon" has been an unanswerable
 * question, with no trace anywhere of the refusal or the reason.
 *
 * Failures only, and that is the whole scope. Logging successes too would
 * duplicate the audit trail into a second, weaker copy and bury the lines that
 * matter — a log nobody can scan is a log nobody reads. If a latency question
 * ever arrives, `durationMs` is already here to answer it.
 *
 * One line of JSON, because the reader is `grep` or a log shipper. A pretty
 * line is pleasant until somebody has to find every failure for one user across
 * a week.
 *
 * `console.error` rather than a logging dependency: the application runs as one
 * Node process writing to stdout on a LEONI host. A logger would add a
 * dependency, a configuration surface and a transport nobody asked for. If a
 * real sink appears, this is the one function that changes.
 */

export interface FailureEntry {
  /** Correlates every line written while handling one request. */
  readonly requestId: string;
  readonly actorId: string | null;
  /** The tRPC procedure path, e.g. `request.transition`. */
  readonly path: string;
  readonly durationMs: number;
  /**
   * The tRPC code the caller received — `CONFLICT`, `FORBIDDEN`,
   * `INTERNAL_SERVER_ERROR`. Counting by this is how "is anything actually
   * broken" gets separated from "people are hitting rules".
   */
  readonly code: string;
  /**
   * The stable domain code when a business rule refused, `null` otherwise.
   *
   * A `null` here beside an `INTERNAL_SERVER_ERROR` is the signature of an
   * unexpected failure rather than a rule doing its job, which is exactly the
   * line worth alerting on.
   */
  readonly domainCode: string | null;
  readonly message: string;
}

export function logFailure(entry: FailureEntry): void {
  console.error(JSON.stringify({ ...entry, at: new Date().toISOString(), level: "error" }));
}
