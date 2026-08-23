import { describe, expect, it } from "vitest";

import {
  ABC_CLASSES,
  ALERT_LEVELS,
  PERMISSIONS,
  REQUEST_STATUSES,
  ROLES,
  TRANSITIONS,
} from "@leoni/core";

import {
  ABC_CLASS_LABELS_FR,
  ALERT_LEVEL_LABELS_FR,
  PERMISSION_LABELS_FR,
  REQUEST_ACTION_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  ROLE_LABELS_FR,
} from "./fr";

/**
 * The interface is French (brief section 6.2), and every enumerated value the
 * domain can produce must have a French label.
 *
 * `Record<Union, string>` already makes a *missing* key a type error. What it
 * cannot catch is an empty string, a label left in English, or — for the action
 * labels, which are keyed by a plain string — an action added to the workflow
 * table with no wording. Those are what these tests cover, because the failure
 * mode is a screen showing `LTN4_STOCK_OUT` to a storekeeper.
 */

function expectUsableLabel(label: string | undefined, key: string): void {
  expect(label, `${key} has no label`).toBeDefined();
  expect(label?.trim().length, `${key} has an empty label`).toBeGreaterThan(0);
}

describe("French labels cover the whole domain", () => {
  it("labels every role", () => {
    for (const role of ROLES) expectUsableLabel(ROLE_LABELS_FR[role], role);
  });

  it("labels every alert level", () => {
    for (const level of ALERT_LEVELS) expectUsableLabel(ALERT_LEVEL_LABELS_FR[level], level);
  });

  it("labels every ABC class", () => {
    for (const abcClass of ABC_CLASSES) {
      expectUsableLabel(ABC_CLASS_LABELS_FR[abcClass], abcClass);
    }
  });

  it("labels every request status", () => {
    for (const status of REQUEST_STATUSES) {
      expectUsableLabel(REQUEST_STATUS_LABELS_FR[status], status);
    }
  });

  it("labels every permission", () => {
    for (const permission of PERMISSIONS) {
      expectUsableLabel(PERMISSION_LABELS_FR[permission], permission);
    }
  });

  /**
   * The action labels are keyed by the `action` identifier in the domain's
   * transition table, which is a plain string — so the compiler cannot help.
   * Adding a transition without wording its button is caught here instead.
   */
  it("labels every action reachable in the workflow", () => {
    const actions = new Set<string>();
    for (const transitions of Object.values(TRANSITIONS)) {
      for (const transition of transitions) actions.add(transition.action);
    }

    expect(actions.size).toBeGreaterThan(0);
    for (const action of actions) {
      expectUsableLabel(REQUEST_ACTION_LABELS_FR[action], `action "${action}"`);
    }
  });

  it("does not leave an English enum name as its own label", () => {
    // A label identical to the code value means someone forgot to translate it.
    const pairs: [string, string][] = [
      ...ROLES.map((role): [string, string] => [role, ROLE_LABELS_FR[role]]),
      ...ALERT_LEVELS.map((level): [string, string] => [level, ALERT_LEVEL_LABELS_FR[level]]),
      ...REQUEST_STATUSES.map((status): [string, string] => [
        status,
        REQUEST_STATUS_LABELS_FR[status],
      ]),
    ];

    for (const [value, label] of pairs) {
      expect(label, `${value} is not translated`).not.toBe(value);
    }
  });
});
