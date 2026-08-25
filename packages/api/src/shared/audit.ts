/**
 * The audit trail, as the service layer describes it.
 *
 * This module exists so the division of labour around an audited write is
 * explicit, because every feature module repeats it:
 *
 *   the **service** decides which facts to record — what changed, who changed
 *   it, and what the change is called in the language of the business;
 *
 *   the **repository** guarantees they land atomically — it takes the entry as
 *   part of its input and writes it inside the same `db.$transaction` as the
 *   row it describes.
 *
 * The service cannot open the transaction itself: it may not import `@leoni/db`
 * (a lint rule enforces that, and it is what keeps the business rules testable
 * without a database). So the atomicity guarantee has to live one layer down.
 * What must never happen is a repository method that writes the row and returns,
 * leaving the trail to a second call that a later refactor can drop — an audit
 * trail with holes is worse than none, because it is trusted.
 *
 * `RequestStatusHistory` follows the identical shape: no status changes without
 * its history row, in one transaction. See CLAUDE.md section 3.
 */

/**
 * What an audited field may hold.
 *
 * Scalars only, deliberately. An audit payload is read back years later by a
 * human or a CSV export, so a nested object or a `Date` that serialised into
 * one is a value nobody can interpret at that distance — and `unknown` here
 * would not be storable as JSON at all.
 */
export type AuditValue = string | number | boolean | null;

export type AuditPayload = Readonly<Record<string, AuditValue>>;

/** One entry, built by a service and written by a repository. */
export interface AuditEntry {
  /** Prisma model name, e.g. "Article", "ReplenishmentParameter". */
  readonly entity: string;
  readonly entityId: string;
  /** "CREATE", "UPDATE", "DELETE", or a named business action. */
  readonly action: string;
  /** Null on create. Only the fields the operation can actually change. */
  readonly before: AuditPayload | null;
  /** Null on delete. */
  readonly after: AuditPayload | null;
  /** Null when the change came from the nightly job or an import. */
  readonly actorId: string | null;
}
