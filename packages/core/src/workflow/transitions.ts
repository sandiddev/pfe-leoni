import type { Permission } from "../access/permission";
import type { Role } from "../access/role";
import type { RequestStatus } from "./request-status";

/**
 * The transition table — the single source of truth for the workflow.
 *
 * This table is consulted twice for every state change: once on the server to
 * authorise the transition, and once in the UI to decide which action buttons
 * to render. Deriving both from the same data is the reason a storekeeper never
 * sees a button that the server will refuse, and the reason adding a state to
 * the process is a change to one file rather than a hunt through components.
 *
 * `requiresReason` marks the transitions the brief demands a justification for:
 * a rejection or an LTN4 shortage that nobody has to explain is exactly the
 * opacity this project exists to remove.
 */
/**
 * Every action the workflow can perform.
 *
 * A union rather than a bare `string` so that the compiler — not a test —
 * catches a transition whose action has no French label and no permission.
 * `create` is deliberately absent: it is the label on the history row that
 * records creation, not a transition out of a state.
 */
export const TRANSITION_ACTIONS = [
  "submit",
  "approve",
  "reject",
  "cancel",
  "transmit",
  "startPreparation",
  "prepareAvailable",
  "resumePreparation",
  "declarePartial",
  "declareStockOut",
  "markReady",
  "ship",
  "markInTransit",
  "confirmReceipt",
  "close",
] as const;

export type TransitionAction = (typeof TRANSITION_ACTIONS)[number];

export interface TransitionDefinition {
  readonly to: RequestStatus;
  /** Stable identifier for the action; French wording lives in @leoni/contracts. */
  readonly action: TransitionAction;
  readonly allowedRoles: readonly Role[];
  readonly requiresReason: boolean;
}

/**
 * The permission each action requires.
 *
 * The workflow is guarded twice: a tRPC procedure declares a permission, and
 * the transition table lists the roles allowed to perform the action. Those are
 * two statements of the same rule, and nothing made them agree — a role could
 * be added to `allowedRoles` here while its procedure kept refusing it, or
 * worse, the reverse.
 *
 * A request router reads this map instead of restating the permission per
 * procedure, and `transitions.test.ts` asserts that every role listed below
 * actually holds the permission its action needs.
 *
 * `reject` maps to `request:approve` on purpose: approving and refusing are the
 * same authority — the decision of the LTN1 warehouse manager — exercised in
 * opposite directions. A separate `request:reject` would suggest a role could
 * hold one without the other, which the process does not allow.
 */
export const ACTION_PERMISSIONS: Readonly<Record<TransitionAction, Permission>> = {
  submit: "request:create",
  approve: "request:approve",
  reject: "request:approve",
  cancel: "request:cancel",
  transmit: "request:transmit",
  startPreparation: "request:prepare",
  prepareAvailable: "request:prepare",
  resumePreparation: "request:prepare",
  declarePartial: "request:prepare",
  declareStockOut: "request:prepare",
  markReady: "request:prepare",
  ship: "request:ship",
  markInTransit: "request:ship",
  confirmReceipt: "request:receive",
  close: "request:close",
};

/** Roles permitted to abandon a request before LTN4 has acted on it. */
const LTN1_REQUESTERS: readonly Role[] = ["LTN1_STOREKEEPER", "ADMIN"];
const LTN1_APPROVERS: readonly Role[] = ["LTN1_WAREHOUSE_MANAGER", "ADMIN"];
const LTN4_HANDLERS: readonly Role[] = ["LTN4_RESPONSIBLE", "ADMIN"];

export const TRANSITIONS: Readonly<Record<RequestStatus, readonly TransitionDefinition[]>> = {
  DRAFT: [
    {
      to: "PENDING_APPROVAL",
      action: "submit",
      allowedRoles: LTN1_REQUESTERS,
      requiresReason: false,
    },
    { to: "CANCELLED", action: "cancel", allowedRoles: LTN1_REQUESTERS, requiresReason: true },
  ],

  PENDING_APPROVAL: [
    { to: "APPROVED", action: "approve", allowedRoles: LTN1_APPROVERS, requiresReason: false },
    { to: "REJECTED", action: "reject", allowedRoles: LTN1_APPROVERS, requiresReason: true },
    { to: "CANCELLED", action: "cancel", allowedRoles: LTN1_REQUESTERS, requiresReason: true },
  ],

  APPROVED: [
    { to: "SENT_TO_LTN4", action: "transmit", allowedRoles: LTN1_APPROVERS, requiresReason: false },
    { to: "CANCELLED", action: "cancel", allowedRoles: LTN1_APPROVERS, requiresReason: true },
  ],

  SENT_TO_LTN4: [
    {
      to: "IN_PREPARATION",
      action: "startPreparation",
      allowedRoles: LTN4_HANDLERS,
      requiresReason: false,
    },
    {
      to: "PARTIALLY_AVAILABLE",
      action: "declarePartial",
      allowedRoles: LTN4_HANDLERS,
      requiresReason: true,
    },
    {
      to: "LTN4_STOCK_OUT",
      action: "declareStockOut",
      allowedRoles: LTN4_HANDLERS,
      requiresReason: true,
    },
    { to: "CANCELLED", action: "cancel", allowedRoles: LTN1_APPROVERS, requiresReason: true },
  ],

  IN_PREPARATION: [
    { to: "READY", action: "markReady", allowedRoles: LTN4_HANDLERS, requiresReason: false },
    {
      to: "PARTIALLY_AVAILABLE",
      action: "declarePartial",
      allowedRoles: LTN4_HANDLERS,
      requiresReason: true,
    },
    {
      to: "LTN4_STOCK_OUT",
      action: "declareStockOut",
      allowedRoles: LTN4_HANDLERS,
      requiresReason: true,
    },
  ],

  // A partial availability is not a dead end: LTN4 prepares what it has, and
  // the shortfall is either carried on the line or documented at closure.
  PARTIALLY_AVAILABLE: [
    {
      to: "IN_PREPARATION",
      action: "prepareAvailable",
      allowedRoles: LTN4_HANDLERS,
      requiresReason: false,
    },
    { to: "READY", action: "markReady", allowedRoles: LTN4_HANDLERS, requiresReason: false },
    { to: "CANCELLED", action: "cancel", allowedRoles: LTN1_APPROVERS, requiresReason: true },
  ],

  LTN4_STOCK_OUT: [
    {
      to: "IN_PREPARATION",
      action: "resumePreparation",
      allowedRoles: LTN4_HANDLERS,
      requiresReason: false,
    },
    { to: "CANCELLED", action: "cancel", allowedRoles: LTN1_APPROVERS, requiresReason: true },
  ],

  READY: [{ to: "SHIPPED", action: "ship", allowedRoles: LTN4_HANDLERS, requiresReason: false }],

  // The inter-plant leg is short. `IN_TRANSIT` exists so a long or delayed
  // transport can be tracked, but LTN1 is allowed to confirm receipt directly
  // when the truck arrives the same day.
  SHIPPED: [
    {
      to: "IN_TRANSIT",
      action: "markInTransit",
      allowedRoles: LTN4_HANDLERS,
      requiresReason: false,
    },
    {
      to: "RECEIVED",
      action: "confirmReceipt",
      allowedRoles: LTN1_REQUESTERS,
      requiresReason: false,
    },
  ],

  IN_TRANSIT: [
    {
      to: "RECEIVED",
      action: "confirmReceipt",
      allowedRoles: LTN1_REQUESTERS,
      requiresReason: false,
    },
  ],

  RECEIVED: [
    {
      to: "CLOSED",
      action: "close",
      allowedRoles: [...LTN1_REQUESTERS, "LTN1_WAREHOUSE_MANAGER"],
      requiresReason: false,
    },
  ],

  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
};

/**
 * The line column each action records, and the columns it carries forward from.
 *
 * Here rather than in the API for the same reason `TRANSITIONS` is: it is read
 * twice per state change — once on the server to decide which column a
 * transition writes, and once in the UI to decide whether to ask for
 * quantities at all. Deriving both from one table is why a dialog cannot offer
 * a figure the server would ignore, and why adding a stage that records a
 * quantity is a change to this file rather than a hunt through components.
 *
 * The client names the **action**, never the column. A payload that chose the
 * column could write "received" while approving, which is how a service-level
 * KPI quietly becomes fiction.
 *
 * An action absent from this table records no quantity: `markInTransit` moves a
 * lorry, not a number, and `cancel` ends the request without one.
 */
/**
 * The columns a transition may write.
 *
 * `requestedQuantity` is deliberately absent: it is what the storekeeper asked
 * for, set once when the request is raised. A transition that could overwrite it
 * would erase the demand the whole trail is measured against — the gap between
 * requested and received *is* the service level.
 */
export const LINE_QUANTITY_FIELDS = [
  "approvedQuantity",
  "preparedQuantity",
  "shippedQuantity",
  "receivedQuantity",
] as const;

export type LineQuantityField = (typeof LINE_QUANTITY_FIELDS)[number];

/**
 * The columns a transition may read a carried-forward figure from.
 *
 * The mirror image: `requestedQuantity` is readable — it is where the chain
 * starts — and `receivedQuantity` is not, because nothing happens after a
 * receipt that needs to carry it forward.
 */
export const CARRIED_FROM_FIELDS = [
  "requestedQuantity",
  "approvedQuantity",
  "preparedQuantity",
  "shippedQuantity",
] as const;

export type CarriedFromField = (typeof CARRIED_FROM_FIELDS)[number];

export interface QuantityPlan {
  readonly field: LineQuantityField;
  /** Tried in order; the first stage that recorded a figure wins. */
  readonly from: readonly CarriedFromField[];
}

/**
 * Every action in the preparation loop writes the same column, so it must read
 * that column before falling back.
 *
 * `preparedQuantity` first is load-bearing. Five actions write it, and
 * `PARTIALLY_AVAILABLE` and `LTN4_STOCK_OUT` both lead back into
 * `IN_PREPARATION` — so unlike the other stages, this one routinely runs when
 * its own column already holds a figure. Reading `approvedQuantity` first meant
 * that declaring a partial and then marking the pallet ready silently restored
 * the full approved quantity, erasing the shortfall LTN4 had just declared and
 * the reason it gave for it.
 */
const PREPARATION_PLAN: QuantityPlan = {
  field: "preparedQuantity",
  from: ["preparedQuantity", "approvedQuantity", "requestedQuantity"],
};

export const QUANTITY_PLANS: Readonly<Partial<Record<TransitionAction, QuantityPlan>>> = {
  approve: { field: "approvedQuantity", from: ["requestedQuantity"] },
  startPreparation: PREPARATION_PLAN,
  prepareAvailable: PREPARATION_PLAN,
  resumePreparation: PREPARATION_PLAN,
  declarePartial: PREPARATION_PLAN,
  markReady: PREPARATION_PLAN,
  ship: { field: "shippedQuantity", from: ["preparedQuantity", "approvedQuantity"] },
  confirmReceipt: { field: "receivedQuantity", from: ["shippedQuantity", "preparedQuantity"] },
};

/**
 * The quantity plan for an action, or `null` if it records none.
 *
 * A function rather than direct indexing so the UI has one thing to ask, and so
 * `noUncheckedIndexedAccess` does not push an `undefined` check into every
 * caller.
 */
export function quantityPlanFor(action: TransitionAction): QuantityPlan | null {
  return QUANTITY_PLANS[action] ?? null;
}
