import type {
  AvailableAction,
  RequestCommentItem,
  RequestDetail,
  RequestHistoryEntry,
  RequestLineItem,
  RequestListItem,
} from "@leoni/contracts";
import type { Role, TransitionAction } from "@leoni/core";
import { assessLateness, availableTransitions, isRequestStatus, TRANSITION_ACTIONS } from "@leoni/core";

import type { RequestDetailRow, RequestRow } from "./request.repository";

/**
 * Database rows to the DTOs the workflow screens render.
 *
 * The one computed field is lateness, and it is computed here rather than
 * stored because `LATE` is deliberately not a status: a request can be late
 * while it is still in preparation, and stamping that on the row would
 * overwrite where it actually is. See `request-status.ts`.
 */

export function toListItem(row: RequestRow, now: Date): RequestListItem {
  const lateness = assessLateness({
    status: row.status,
    expectedDeliveryAt: row.expectedDeliveryAt,
    receivedAt: row.receivedAt,
    now,
  });

  return {
    id: row.id,
    code: row.code,
    status: row.status,
    priority: row.priority,
    fromSiteCode: row.fromSite.code,
    toSiteCode: row.toSite.code,
    createdByName: row.createdBy.name,
    lineCount: row.lines.length,
    totalRequested: row.lines.reduce((sum, line) => sum + line.requestedQuantity, 0),
    expectedDeliveryAt: row.expectedDeliveryAt,
    createdAt: row.createdAt,
    isLate: lateness.isLate,
    daysLate: lateness.daysLate,
  };
}

type LineRow = RequestDetailRow["lines"][number];

export function toLineItem(row: LineRow): RequestLineItem {
  return {
    id: row.id,
    articleId: row.articleId,
    reference: row.article.reference,
    designation: row.article.designation,
    requestedQuantity: row.requestedQuantity,
    approvedQuantity: row.approvedQuantity,
    preparedQuantity: row.preparedQuantity,
    shippedQuantity: row.shippedQuantity,
    receivedQuantity: row.receivedQuantity,
    vpeSnapshot: row.vpeSnapshot,
    suggestedQuantity: row.suggestedQuantity,
    note: row.note,
  };
}

type HistoryRow = RequestDetailRow["statusHistory"][number];

/**
 * The stored action is a plain string, because the column is.
 *
 * Narrowing it here — rather than widening the DTO to `string` — is what lets
 * the screen index the French label map without a cast. An action nobody
 * recognises falls back to "create", which is the only value that can appear
 * on a history row without being a transition.
 */
function toAction(value: string): TransitionAction | "create" {
  const match = TRANSITION_ACTIONS.find((candidate) => candidate === value);
  return match ?? "create";
}

export function toHistoryEntry(row: HistoryRow): RequestHistoryEntry {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    action: toAction(row.action),
    reason: row.reason,
    userName: row.user?.name ?? null,
    occurredAt: row.occurredAt,
  };
}

type CommentRow = RequestDetailRow["comments"][number];

export function toCommentItem(row: CommentRow): RequestCommentItem {
  return {
    id: row.id,
    content: row.content,
    userName: row.user.name,
    createdAt: row.createdAt,
  };
}

/**
 * The buttons this role may press, straight from the domain transition table.
 *
 * Deriving them rather than listing them per screen is what guarantees a user
 * is never offered an action the server would refuse — and that adding a stage
 * to the process is a change to one file in `@leoni/core`.
 */
export function toAvailableActions(status: string, role: Role): readonly AvailableAction[] {
  if (!isRequestStatus(status)) return [];

  return availableTransitions(status, role).map((transition) => ({
    action: transition.action,
    to: transition.to,
    requiresReason: transition.requiresReason,
  }));
}

export function toDetail(row: RequestDetailRow, role: Role, now: Date): RequestDetail {
  return {
    ...toListItem(row, now),
    reason: row.reason,
    approvedByName: row.approvedBy?.name ?? null,
    submittedAt: row.submittedAt,
    approvedAt: row.approvedAt,
    sentAt: row.sentAt,
    preparedAt: row.preparedAt,
    shippedAt: row.shippedAt,
    receivedAt: row.receivedAt,
    closedAt: row.closedAt,
    lines: row.lines.map(toLineItem),
    history: row.statusHistory.map(toHistoryEntry),
    comments: row.comments.map(toCommentItem),
    availableActions: toAvailableActions(row.status, role),
  };
}
