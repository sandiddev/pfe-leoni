import { describe, expect, it } from "vitest";

import { type Role, ROLES } from "../access/role";
import { TransitionNotAllowedError } from "../errors/domain-error";
import { assertTransition, availableTransitions, canTransition } from "./can-transition";
import { REQUEST_STATUSES, type RequestStatus, TERMINAL_STATUSES } from "./request-status";
import { TRANSITIONS } from "./transitions";

describe("the nominal lifecycle (brief section 5)", () => {
  /**
   * Walks the happy path exactly as the process document describes it, with the
   * role that owns each step. If a transition or a role assignment is ever
   * changed by accident, this test names the step that broke.
   */
  it("can be walked end to end by the intended roles", () => {
    const journey: { from: RequestStatus; to: RequestStatus; role: Role }[] = [
      { from: "DRAFT", to: "PENDING_APPROVAL", role: "LTN1_STOREKEEPER" },
      { from: "PENDING_APPROVAL", to: "APPROVED", role: "LTN1_WAREHOUSE_MANAGER" },
      { from: "APPROVED", to: "SENT_TO_LTN4", role: "LTN1_WAREHOUSE_MANAGER" },
      { from: "SENT_TO_LTN4", to: "IN_PREPARATION", role: "LTN4_RESPONSIBLE" },
      { from: "IN_PREPARATION", to: "READY", role: "LTN4_RESPONSIBLE" },
      { from: "READY", to: "SHIPPED", role: "LTN4_RESPONSIBLE" },
      { from: "SHIPPED", to: "IN_TRANSIT", role: "LTN4_RESPONSIBLE" },
      { from: "IN_TRANSIT", to: "RECEIVED", role: "LTN1_STOREKEEPER" },
      { from: "RECEIVED", to: "CLOSED", role: "LTN1_STOREKEEPER" },
    ];

    for (const step of journey) {
      expect(canTransition(step), `${step.from} -> ${step.to} as ${step.role}`).toBe(true);
    }
  });
});

describe("role enforcement", () => {
  it("prevents a storekeeper from approving their own request", () => {
    // This is the separation of duties the whole approval step exists for.
    expect(() =>
      assertTransition({ from: "PENDING_APPROVAL", to: "APPROVED", role: "LTN1_STOREKEEPER" }),
    ).toThrow(TransitionNotAllowedError);
  });

  it("prevents LTN4 from approving an LTN1 request", () => {
    expect(
      canTransition({ from: "PENDING_APPROVAL", to: "APPROVED", role: "LTN4_RESPONSIBLE" }),
    ).toBe(false);
  });

  it("prevents LTN1 from marking material as prepared on behalf of LTN4", () => {
    expect(
      canTransition({ from: "SENT_TO_LTN4", to: "IN_PREPARATION", role: "LTN1_STOREKEEPER" }),
    ).toBe(false);
  });

  it("prevents LTN4 from confirming receipt at LTN1", () => {
    expect(canTransition({ from: "IN_TRANSIT", to: "RECEIVED", role: "LTN4_RESPONSIBLE" })).toBe(
      false,
    );
  });

  it("gives the logistics manager no write access to the workflow at all", () => {
    // Section 4: the logistics manager is read-only across both sites.
    for (const status of REQUEST_STATUSES) {
      expect(availableTransitions(status, "LOGISTICS_MANAGER")).toStrictEqual([]);
    }
  });

  it("lets the administrator perform every defined transition", () => {
    for (const status of REQUEST_STATUSES) {
      expect(availableTransitions(status, "ADMIN")).toHaveLength(TRANSITIONS[status].length);
    }
  });
});

describe("structural rules", () => {
  it("refuses a transition that is not on the map", () => {
    expect(() => assertTransition({ from: "SHIPPED", to: "DRAFT", role: "ADMIN" })).toThrow(
      TransitionNotAllowedError,
    );
  });

  it("refuses to skip the approval step", () => {
    expect(canTransition({ from: "DRAFT", to: "APPROVED", role: "ADMIN" })).toBe(false);
  });

  it("refuses to ship material that was never prepared", () => {
    expect(canTransition({ from: "SENT_TO_LTN4", to: "SHIPPED", role: "ADMIN" })).toBe(false);
  });

  it.each(TERMINAL_STATUSES)("leaves no way out of %s", (status) => {
    for (const role of ROLES) {
      expect(availableTransitions(status, role)).toStrictEqual([]);
    }
  });

  it("only ever targets a status that exists", () => {
    for (const status of REQUEST_STATUSES) {
      for (const transition of TRANSITIONS[status]) {
        expect(REQUEST_STATUSES).toContain(transition.to);
      }
    }
  });

  it("never defines the same target twice from one status", () => {
    for (const status of REQUEST_STATUSES) {
      const targets = TRANSITIONS[status].map((transition) => transition.to);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });

  it("makes every non-terminal status reachable from DRAFT", () => {
    // An unreachable status is dead code in the process itself.
    const reachable = new Set<RequestStatus>(["DRAFT"]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const status of reachable) {
        for (const transition of TRANSITIONS[status]) {
          if (!reachable.has(transition.to)) {
            reachable.add(transition.to);
            changed = true;
          }
        }
      }
    }

    for (const status of REQUEST_STATUSES) {
      expect(reachable.has(status), `${status} is unreachable`).toBe(true);
    }
  });
});

describe("mandatory justifications", () => {
  it("refuses a rejection with no reason", () => {
    expect(() =>
      assertTransition({
        from: "PENDING_APPROVAL",
        to: "REJECTED",
        role: "LTN1_WAREHOUSE_MANAGER",
      }),
    ).toThrow(TransitionNotAllowedError);
  });

  it("refuses a rejection whose reason is only whitespace", () => {
    expect(() =>
      assertTransition({
        from: "PENDING_APPROVAL",
        to: "REJECTED",
        role: "LTN1_WAREHOUSE_MANAGER",
        reason: "   ",
      }),
    ).toThrow(TransitionNotAllowedError);
  });

  it("accepts a rejection with a reason", () => {
    const transition = assertTransition({
      from: "PENDING_APPROVAL",
      to: "REJECTED",
      role: "LTN1_WAREHOUSE_MANAGER",
      reason: "Quantite superieure au besoin reel.",
    });

    expect(transition.action).toBe("reject");
  });

  it("requires LTN4 to justify a declared shortage", () => {
    expect(
      canTransition({ from: "SENT_TO_LTN4", to: "LTN4_STOCK_OUT", role: "LTN4_RESPONSIBLE" }),
    ).toBe(false);

    expect(
      canTransition({
        from: "SENT_TO_LTN4",
        to: "LTN4_STOCK_OUT",
        role: "LTN4_RESPONSIBLE",
        reason: "Rupture fournisseur amont.",
      }),
    ).toBe(true);
  });
});

describe("exception paths", () => {
  it("lets a partially available request continue rather than dead-end", () => {
    expect(
      canTransition({ from: "PARTIALLY_AVAILABLE", to: "READY", role: "LTN4_RESPONSIBLE" }),
    ).toBe(true);
  });

  it("lets preparation resume once an LTN4 shortage is resolved", () => {
    expect(
      canTransition({ from: "LTN4_STOCK_OUT", to: "IN_PREPARATION", role: "LTN4_RESPONSIBLE" }),
    ).toBe(true);
  });

  it("allows direct receipt for a same-day inter-plant delivery", () => {
    expect(canTransition({ from: "SHIPPED", to: "RECEIVED", role: "LTN1_STOREKEEPER" })).toBe(true);
  });

  it("requires a reason to cancel", () => {
    expect(canTransition({ from: "DRAFT", to: "CANCELLED", role: "LTN1_STOREKEEPER" })).toBe(false);
    expect(
      canTransition({
        from: "DRAFT",
        to: "CANCELLED",
        role: "LTN1_STOREKEEPER",
        reason: "Besoin couvert par une autre demande.",
      }),
    ).toBe(true);
  });
});
