import { describe, expect, it } from "vitest";

import {
  ABC_CLASSES,
  ALERT_LEVELS,
  NOTIFICATION_TYPES,
  PERMISSIONS,
  REQUEST_STATUSES,
  ROLES,
  SITE_TYPES,
  TRANSITION_ACTIONS,
  type TransitionAction,
  TRANSITIONS,
} from "@leoni/core";

import {
  ABC_CLASS_LABELS_FR,
  ALERT_LEVEL_LABELS_FR,
  NOTIFICATION_TYPE_LABELS_FR,
  PERMISSION_LABELS_FR,
  REQUEST_ACTION_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  ROLE_LABELS_FR,
  SITE_TYPE_LABELS_FR,
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

  it("labels every notification type", () => {
    for (const type of NOTIFICATION_TYPES) {
      expectUsableLabel(NOTIFICATION_TYPE_LABELS_FR[type], type);
    }
  });

  it("labels every site type", () => {
    for (const type of SITE_TYPES) expectUsableLabel(SITE_TYPE_LABELS_FR[type], type);
  });

  it("labels every permission", () => {
    for (const permission of PERMISSIONS) {
      expectUsableLabel(PERMISSION_LABELS_FR[permission], permission);
    }
  });

  /**
   * `TransitionAction` now types the label map, so a missing label fails to
   * compile rather than at runtime. What the compiler still cannot check is
   * that every action is *reachable* — an action declared in the union and
   * labelled, but wired into no transition, is a button nobody can ever press.
   */
  it("labels every action reachable in the workflow", () => {
    const actions = new Set<TransitionAction>();
    for (const transitions of Object.values(TRANSITIONS)) {
      for (const transition of transitions) actions.add(transition.action);
    }

    expect(actions.size).toBe(TRANSITION_ACTIONS.length);
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
