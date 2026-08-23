import { REQUEST_STATUS_LABELS_FR } from "@leoni/contracts";
import type { RequestStatus } from "@leoni/core";

import { Badge, type BadgeProps } from "../primitives/badge";

/**
 * Renders a request status.
 *
 * Fourteen statuses are mapped onto five visual phases rather than fourteen
 * colours. A reader scanning a list of requests is asking one question — is
 * this waiting on someone, moving, finished, or stopped — and fourteen hues
 * answer it worse than five do. The exact status is still written out in words;
 * the colour only carries the phase.
 */
const PHASE_BY_STATUS: Readonly<Record<RequestStatus, NonNullable<BadgeProps["variant"]>>> = {
  DRAFT: "draft",

  // Waiting on a human decision.
  PENDING_APPROVAL: "pending",

  // Moving through the pipeline.
  APPROVED: "active",
  SENT_TO_LTN4: "active",
  IN_PREPARATION: "active",
  READY: "active",
  SHIPPED: "active",
  IN_TRANSIT: "active",

  // Blocked at LTN4 — visually as serious as a failure, because for the
  // production line at LTN1 that is exactly what it is.
  PARTIALLY_AVAILABLE: "pending",
  LTN4_STOCK_OUT: "stopped",

  // Settled.
  RECEIVED: "done",
  CLOSED: "done",

  // Ended without delivering.
  REJECTED: "stopped",
  CANCELLED: "draft",
};

export interface RequestStatusBadgeProps {
  readonly status: RequestStatus;
  readonly className?: string;
}

export function RequestStatusBadge({ status, className }: RequestStatusBadgeProps) {
  return (
    <Badge variant={PHASE_BY_STATUS[status]} className={className}>
      {REQUEST_STATUS_LABELS_FR[status]}
    </Badge>
  );
}
