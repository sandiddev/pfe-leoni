import { REQUEST_ACTION_LABELS_FR, type RequestHistoryEntry } from "@leoni/contracts";
import { formatDateTime, RequestStatusBadge } from "@leoni/ui";

export interface RequestTimelineProps {
  readonly history: readonly RequestHistoryEntry[];
}

/**
 * The workflow trail.
 *
 * This is what the project replaces the mailbox with: who moved the request,
 * when, and — where the domain demands one — why. Every row here was written in
 * the same transaction as the status change it describes, so the sequence
 * cannot have holes.
 */
export function RequestTimeline({ history }: RequestTimelineProps) {
  return (
    <ol className="space-y-3">
      {history.map((entry) => (
        <li key={entry.id} className="flex gap-3 text-sm">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-border-strong" aria-hidden />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">
                {REQUEST_ACTION_LABELS_FR[entry.action]}
              </span>
              <RequestStatusBadge status={entry.toStatus} />
              <span className="text-foreground-muted">
                {formatDateTime(entry.occurredAt)}
                {entry.userName === null ? "" : ` — ${entry.userName}`}
              </span>
            </div>
            {entry.reason !== null && (
              <p className="rounded-md bg-surface-sunken px-3 py-2 text-foreground-muted">
                {entry.reason}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
