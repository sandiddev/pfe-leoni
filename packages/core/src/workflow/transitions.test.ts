import { describe, expect, it } from "vitest";

import { can } from "../access/permissions";
import { ROLES } from "../access/role";
import { isTerminalStatus, REQUEST_STATUSES } from "./request-status";
import {
  ACTION_PERMISSIONS,
  QUANTITY_PLANS,
  quantityPlanFor,
  TRANSITION_ACTIONS,
  TRANSITIONS,
} from "./transitions";

/**
 * The workflow is guarded in two places that must agree.
 *
 * A tRPC procedure declares the permission it requires; the transition table
 * lists the roles allowed to perform the action. Both encode "who may approve a
 * request", and nothing made them consistent — a role could sit in
 * `allowedRoles` while its procedure refused it (a button that always errors),
 * or hold the permission while the table refused it (an authorised user who
 * cannot act). Neither shows up in a type.
 *
 * This is the same guarantee `enum-parity.test.ts` gives the enums, for the
 * pairing that actually decides who can move stock between the plants.
 */

const allTransitions = Object.entries(TRANSITIONS).flatMap(([from, transitions]) =>
  transitions.map((transition) => ({ from, ...transition })),
);

describe("transition table against the permission matrix (brief sections 4 and 5)", () => {
  it.each(allTransitions.map((t) => [`${t.from} -> ${t.to} (${t.action})`, t] as const))(
    "%s: every allowed role holds the permission the action needs",
    (_label, transition) => {
      const permission = ACTION_PERMISSIONS[transition.action];

      for (const role of transition.allowedRoles) {
        expect(
          can(role, permission),
          `${role} may perform "${transition.action}" but does not hold ${permission}`,
        ).toBe(true);
      }
    },
  );

  it("wires every declared action into at least one transition", () => {
    // An action that is labelled and permissioned but reachable from no state
    // is a button nobody can press.
    const used = new Set(allTransitions.map((transition) => transition.action));
    expect([...used].toSorted()).toStrictEqual([...TRANSITION_ACTIONS].toSorted());
  });

  it("gives every action a role that can actually perform it", () => {
    // A transition whose permission no listed role holds is unreachable, which
    // would strand a request in whatever state declares it.
    for (const transition of allTransitions) {
      const permission = ACTION_PERMISSIONS[transition.action];
      const capable = transition.allowedRoles.filter((role) => can(role, permission));

      expect(capable.length).toBeGreaterThan(0);
    }
  });

  it("leaves no non-terminal status without a way out", () => {
    // A status with no transitions that is not terminal is a trap: the request
    // is stuck there and only a database edit can move it.
    for (const status of REQUEST_STATUSES) {
      if (isTerminalStatus(status)) {
        expect(TRANSITIONS[status]).toStrictEqual([]);
      } else {
        expect(TRANSITIONS[status].length).toBeGreaterThan(0);
      }
    }
  });

  it("demands a justification wherever the process owes an explanation", () => {
    // Brief section 5: a rejection, a cancellation or an LTN4 shortage that
    // nobody has to explain is exactly the opacity this project removes.
    const mustExplain = new Set(["reject", "cancel", "declarePartial", "declareStockOut"]);

    for (const transition of allTransitions) {
      if (mustExplain.has(transition.action)) {
        expect(transition.requiresReason, `${transition.action} must require a reason`).toBe(true);
      }
    }
  });

  it("never lets a single role drive a request from draft to closed alone", () => {
    // Separation of duties: the storekeeper who raises a request must not also
    // be the one who approves it. ADMIN is exempt by design — it is the
    // break-glass role, and the audit trail is what governs its use.
    const nominalActions = ["submit", "approve", "transmit"] as const;

    for (const role of ROLES) {
      if (role === "ADMIN") continue;

      const performsAll = nominalActions.every((action) =>
        allTransitions.some(
          (transition) => transition.action === action && transition.allowedRoles.includes(role),
        ),
      );

      expect(performsAll, `${role} can raise, approve and transmit unaided`).toBe(false);
    }
  });
});

describe("the line-quantity plans (brief section 6)", () => {
  it("plans a quantity only for actions the workflow actually defines", () => {
    // The table is keyed by action, and a key that matches no transition is a
    // column nothing will ever write — dead configuration that reads as though
    // a stage records a figure when no stage exists.
    for (const action of Object.keys(QUANTITY_PLANS)) {
      expect(
        TRANSITION_ACTIONS.some((candidate) => candidate === action),
        `${action} has a quantity plan but is not a transition action`,
      ).toBe(true);
    }
  });

  it("carries every plan forward from a column something can have written", () => {
    // A plan reading a column no earlier stage writes would silently fall
    // through to the requested quantity, which looks like a working carry-
    // forward and is really a stage that lost its predecessor's figure.
    const written = new Set<string>(["requestedQuantity"]);
    for (const plan of Object.values(QUANTITY_PLANS)) written.add(plan.field);

    for (const [action, plan] of Object.entries(QUANTITY_PLANS)) {
      for (const source of plan.from) {
        expect(written.has(source), `${action} carries forward from an unwritten ${source}`).toBe(
          true,
        );
      }
    }
  });

  it("never writes the requested quantity", () => {
    // It is the demand the whole trail is measured against: the gap between
    // requested and received is the service level. A transition that could
    // overwrite it would erase the denominator.
    for (const [action, plan] of Object.entries(QUANTITY_PLANS)) {
      expect(plan.field, `${action} overwrites the requested quantity`).not.toBe(
        "requestedQuantity",
      );
    }
  });

  it("names the stage's own column before falling back", () => {
    // `ship` must read `preparedQuantity` before `approvedQuantity`: LTN4 having
    // prepared less than was approved is exactly the partial this exists for,
    // and reading the approved figure first would ship a quantity nobody picked.
    expect(quantityPlanFor("ship")?.from[0]).toBe("preparedQuantity");
    expect(quantityPlanFor("confirmReceipt")?.from[0]).toBe("shippedQuantity");
  });

  it("re-reads its own column wherever more than one action writes it", () => {
    // The invariant that matters for a shortfall surviving. A column written by
    // several actions is a column that can already hold a figure when the next
    // one runs — the preparation loop is exactly that, since
    // PARTIALLY_AVAILABLE and LTN4_STOCK_OUT both lead back into
    // IN_PREPARATION. Such a plan must read its own column first or it
    // overwrites the figure with an earlier stage's.
    //
    // This is not hypothetical: `markReady` carried forward from
    // `approvedQuantity`, so declaring a partial and then marking the pallet
    // ready restored the full approved quantity and erased both the shortfall
    // and the reason LTN4 had given for it.
    const writers = new Map<string, number>();
    for (const plan of Object.values(QUANTITY_PLANS)) {
      writers.set(plan.field, (writers.get(plan.field) ?? 0) + 1);
    }

    for (const [action, plan] of Object.entries(QUANTITY_PLANS)) {
      if ((writers.get(plan.field) ?? 0) < 2) continue;

      expect(
        plan.from[0],
        `${action} writes ${plan.field}, which several actions write, but reads ` +
          `${String(plan.from[0])} first — it would overwrite a figure already recorded`,
      ).toBe(plan.field);
    }
  });

  it("records no quantity for an action that moves no goods", () => {
    // `markInTransit` moves a lorry, `cancel` ends the request. Neither has a
    // figure to record, and inventing one would put a quantity in the trail
    // that no physical event supports.
    expect(quantityPlanFor("markInTransit")).toBeNull();
    expect(quantityPlanFor("cancel")).toBeNull();
    expect(quantityPlanFor("reject")).toBeNull();
  });
});
