import { describe, expect, it } from "vitest";

import { can } from "../access/permissions";
import { ROLES } from "../access/role";
import { isTerminalStatus, REQUEST_STATUSES } from "./request-status";
import { ACTION_PERMISSIONS, TRANSITION_ACTIONS, TRANSITIONS } from "./transitions";

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
          (transition) =>
            transition.action === action && transition.allowedRoles.includes(role),
        ),
      );

      expect(performsAll, `${role} can raise, approve and transmit unaided`).toBe(false);
    }
  });
});
