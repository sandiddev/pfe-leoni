import { z } from "zod";

import type { AlertLevel, RequestPriority, RequestStatus, TransitionAction } from "@leoni/core";
import { REQUEST_PRIORITIES, TRANSITION_ACTIONS } from "@leoni/core";

import {
  idSchema,
  paginationSchema,
  positiveQuantitySchema,
  quantitySchema,
  reasonSchema,
  requestStatusSchema,
  searchSchema,
} from "./common";

/**
 * The replenishment request — the workflow this project exists to make visible.
 *
 * The five quantity columns per line are the reason the DTOs below are not one
 * `quantity` field: what was asked for, authorised, picked, shipped and
 * received are five different facts, and collapsing them would make partial
 * shipment unrepresentable and every service-level KPI uncomputable.
 */

export const requestPrioritySchema = z.enum(REQUEST_PRIORITIES);
export const transitionActionSchema = z.enum(TRANSITION_ACTIONS);

// --- Inputs -----------------------------------------------------------------

export const requestListInputSchema = paginationSchema.extend({
  search: searchSchema,
  siteId: idSchema.optional(),
  status: requestStatusSchema.optional(),
  priority: requestPrioritySchema.optional(),
  /** Only the requests this user raised. */
  onlyMine: z.boolean().default(false),
  /** Only requests past their committed delivery date. */
  onlyLate: z.boolean().default(false),
});

export type RequestListInput = z.infer<typeof requestListInputSchema>;

export const requestByIdInputSchema = z.object({ requestId: idSchema });

export type RequestByIdInput = z.infer<typeof requestByIdInputSchema>;

export const createRequestLineSchema = z.object({
  articleId: idSchema,
  requestedQuantity: positiveQuantitySchema,
  note: z.string().trim().max(500).optional(),
});

export const createRequestInputSchema = z.object({
  priority: requestPrioritySchema.default("NORMAL"),
  expectedDeliveryAt: z.date().optional(),
  lines: z
    .array(createRequestLineSchema)
    .min(1, "Une demande doit comporter au moins une ligne")
    .max(100, "Trop de lignes pour une seule demande"),
});

export type CreateRequestInput = z.infer<typeof createRequestInputSchema>;

/**
 * The quantity a transition records on a line.
 *
 * Which column it lands in is decided by the action, not by the client: an
 * approval writes the authorised quantity, a shipment the shipped one. A
 * payload that named the column would let a caller write "received" while
 * approving.
 */
export const transitionLineSchema = z.object({
  lineId: idSchema,
  quantity: quantitySchema,
});

export const transitionRequestInputSchema = z.object({
  requestId: idSchema,
  action: transitionActionSchema,
  /** Mandatory for the transitions the domain marks `requiresReason`. */
  reason: reasonSchema.optional(),
  /** Omitted, each line carries forward the quantity from the previous stage. */
  lines: z.array(transitionLineSchema).max(100).optional(),
  /** LTN4's commitment, set when the request is transmitted or prepared. */
  expectedDeliveryAt: z.date().optional(),
});

export type TransitionRequestInput = z.infer<typeof transitionRequestInputSchema>;

/**
 * Correcting a draft.
 *
 * Only from `DRAFT`, and only by whoever raised it. Before this existed, a
 * typo could only be resolved by cancelling the request with a ten-character
 * written justification — which put a fictional "reason" in the audit trail
 * for something that was never part of the process.
 *
 * The lines replace the existing set rather than patching it: a request is
 * short, and a diff protocol for four rows would be more code and more ways to
 * end up with a line nobody meant to keep.
 */
export const updateDraftInputSchema = z.object({
  requestId: idSchema,
  priority: requestPrioritySchema,
  expectedDeliveryAt: z.date().nullish(),
  lines: z
    .array(createRequestLineSchema)
    .min(1, "Une demande doit comporter au moins une ligne")
    .max(100, "Trop de lignes pour une seule demande"),
});

export type UpdateDraftInput = z.infer<typeof updateDraftInputSchema>;

export const deleteDraftInputSchema = z.object({ requestId: idSchema });

export type DeleteDraftInput = z.infer<typeof deleteDraftInputSchema>;

/**
 * The file types a request may carry.
 *
 * An allow-list, not a block-list: a delivery note is a PDF or a photograph,
 * and everything else arriving on a factory server is a question nobody wants
 * to answer. Enforced on the upload route, which is the only writer.
 */
export const ALLOWED_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;

/** Ten megabytes: a phone photograph of a damaged pallet, not a video. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const attachmentListInputSchema = z.object({ requestId: idSchema });

export type AttachmentListInput = z.infer<typeof attachmentListInputSchema>;

export const recordAttachmentInputSchema = z.object({
  requestId: idSchema,
  fileName: z.string().trim().min(1).max(255),
  storagePath: z.string().min(1).max(500),
  mimeType: z.enum(ALLOWED_ATTACHMENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
});

export type RecordAttachmentInput = z.infer<typeof recordAttachmentInputSchema>;

export const deleteAttachmentInputSchema = z.object({ attachmentId: idSchema });

export type DeleteAttachmentInput = z.infer<typeof deleteAttachmentInputSchema>;

export interface AttachmentItem {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uploadedByName: string;
  readonly createdAt: Date;
}

export const commentRequestInputSchema = z.object({
  requestId: idSchema,
  content: z.string().trim().min(1, "Le commentaire est vide").max(2000, "Commentaire trop long"),
});

export type CommentRequestInput = z.infer<typeof commentRequestInputSchema>;

// --- Outputs ----------------------------------------------------------------

/** One line of a request, with all five quantities. */
export interface RequestLineItem {
  readonly id: string;
  readonly articleId: string;
  readonly reference: string;
  readonly designation: string;

  readonly requestedQuantity: number;
  readonly approvedQuantity: number | null;
  readonly preparedQuantity: number | null;
  readonly shippedQuantity: number | null;
  readonly receivedQuantity: number | null;

  /** Pack size at the time of the request, so old requests still add up. */
  readonly vpeSnapshot: number;
  /** What the domain proposed, next to what the human asked for. */
  readonly suggestedQuantity: number | null;
  readonly note: string | null;
}

/** One row of the request list. */
export interface RequestListItem {
  readonly id: string;
  readonly code: string;
  readonly status: RequestStatus;
  readonly priority: RequestPriority;

  readonly fromSiteCode: string;
  readonly toSiteCode: string;
  readonly createdByName: string;

  readonly lineCount: number;
  readonly totalRequested: number;

  readonly expectedDeliveryAt: Date | null;
  readonly createdAt: Date;

  /**
   * Derived, never stored: a request can be late while it is still in
   * preparation, and encoding that as a status would overwrite where it is.
   */
  readonly isLate: boolean;
  readonly daysLate: number;
}

/** An entry in the workflow trail. */
export interface RequestHistoryEntry {
  readonly id: string;
  readonly fromStatus: RequestStatus | null;
  readonly toStatus: RequestStatus;
  readonly action: TransitionAction | "create";
  readonly reason: string | null;
  readonly userName: string | null;
  readonly occurredAt: Date;
}

export interface RequestCommentItem {
  readonly id: string;
  readonly content: string;
  readonly userName: string;
  readonly createdAt: Date;
}

/** A button the current user may press, as the domain transition table says. */
export interface AvailableAction {
  readonly action: TransitionAction;
  readonly to: RequestStatus;
  readonly requiresReason: boolean;
}

export interface RequestDetail extends RequestListItem {
  readonly reason: string | null;
  readonly approvedByName: string | null;
  readonly submittedAt: Date | null;
  readonly approvedAt: Date | null;
  readonly sentAt: Date | null;
  readonly preparedAt: Date | null;
  readonly shippedAt: Date | null;
  readonly receivedAt: Date | null;
  readonly closedAt: Date | null;

  readonly lines: readonly RequestLineItem[];
  readonly history: readonly RequestHistoryEntry[];
  readonly comments: readonly RequestCommentItem[];
  /** Computed from `availableTransitions`, so the UI never offers a refusal. */
  readonly availableActions: readonly AvailableAction[];
}

/** One end of a transfer, as a transition reports it back to the screen. */
export interface TransitionStockChange {
  readonly articleId: string;
  readonly quantity: number;
  readonly newStock: number;
  readonly alertLevel: AlertLevel;
}

/** What a transition changed, so the screen can confirm it without a refetch. */
export interface TransitionResult {
  readonly requestId: string;
  readonly status: RequestStatus;
  /** Populated by `confirmReceipt`: the stock the receipt put away at LTN1. */
  readonly stockEntries: readonly TransitionStockChange[];
  /** Populated by `ship`: the stock the dispatch took off LTN4. */
  readonly stockExits: readonly TransitionStockChange[];
}
