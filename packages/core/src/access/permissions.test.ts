import { describe, expect, it } from "vitest";

import { type Permission, PERMISSIONS } from "./permission";
import { assertCan, can, canAccessSite, ROLE_PERMISSIONS } from "./permissions";
import { ROLES } from "./role";

const WRITE_PERMISSIONS: readonly Permission[] = [
  "article:write",
  "article:import",
  "stock:move",
  "stock:adjust",
  "request:create",
  "request:approve",
  "request:transmit",
  "request:prepare",
  "request:ship",
  "request:receive",
  "request:close",
  "request:cancel",
  "request:comment",
  "parameter:write",
  "threshold:recalculate",
  "user:write",
];

describe("the role/permission matrix (brief section 4)", () => {
  it("gives the administrator every permission", () => {
    for (const permission of PERMISSIONS) {
      expect(can("ADMIN", permission)).toBe(true);
    }
  });

  it("gives the logistics manager read access and nothing else", () => {
    // Section 4: read-only across both sites. Any write permission appearing
    // here would break the separation the role exists to embody.
    for (const permission of WRITE_PERMISSIONS) {
      expect(can("LOGISTICS_MANAGER", permission), permission).toBe(false);
    }

    expect(can("LOGISTICS_MANAGER", "dashboard:read")).toBe(true);
    expect(can("LOGISTICS_MANAGER", "audit:read")).toBe(true);
    expect(can("LOGISTICS_MANAGER", "report:export")).toBe(true);
  });

  it("lets the storekeeper record movements and receive material", () => {
    expect(can("LTN1_STOREKEEPER", "stock:move")).toBe(true);
    expect(can("LTN1_STOREKEEPER", "request:create")).toBe(true);
    expect(can("LTN1_STOREKEEPER", "request:receive")).toBe(true);
  });

  it("does not let the storekeeper approve requests", () => {
    expect(can("LTN1_STOREKEEPER", "request:approve")).toBe(false);
  });

  it("does not let the warehouse manager fulfil requests on behalf of LTN4", () => {
    expect(can("LTN1_WAREHOUSE_MANAGER", "request:prepare")).toBe(false);
    expect(can("LTN1_WAREHOUSE_MANAGER", "request:ship")).toBe(false);
  });

  it("does not let LTN4 approve or receive", () => {
    expect(can("LTN4_RESPONSIBLE", "request:approve")).toBe(false);
    expect(can("LTN4_RESPONSIBLE", "request:receive")).toBe(false);
  });

  it("reserves master data and user administration for the administrator", () => {
    // Section 4: Min, Max, Lead Time, VPE and ABC class are editable only by
    // the Administrator.
    for (const role of ROLES) {
      if (role === "ADMIN") continue;
      expect(can(role, "article:write"), role).toBe(false);
      expect(can(role, "user:write"), role).toBe(false);
      expect(can(role, "parameter:write"), role).toBe(false);
    }
  });

  it("declares no permission that is not part of the vocabulary", () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it("lists no permission twice for a role", () => {
    for (const role of ROLES) {
      const granted = ROLE_PERMISSIONS[role];
      expect(new Set(granted).size, role).toBe(granted.length);
    }
  });

  it("lets every role read the alert board, which is the shared picture", () => {
    for (const role of ROLES) {
      expect(can(role, "alert:read"), role).toBe(true);
    }
  });

  it("throws a precise error from assertCan", () => {
    expect(() => {
      assertCan("LTN1_STOREKEEPER", "request:approve");
    }).toThrow(/LTN1_STOREKEEPER/);

    expect(() => {
      assertCan("ADMIN", "request:approve");
    }).not.toThrow();
  });
});

describe("canAccessSite (site scoping)", () => {
  const LTN1 = "site-ltn1";
  const LTN4 = "site-ltn4";

  it("confines a storekeeper to their own plant", () => {
    expect(canAccessSite("LTN1_STOREKEEPER", LTN1, LTN1)).toBe(true);
    expect(canAccessSite("LTN1_STOREKEEPER", LTN1, LTN4)).toBe(false);
  });

  it("confines the LTN4 responsible to LTN4", () => {
    expect(canAccessSite("LTN4_RESPONSIBLE", LTN4, LTN4)).toBe(true);
    expect(canAccessSite("LTN4_RESPONSIBLE", LTN4, LTN1)).toBe(false);
  });

  it("lets the administrator and the logistics manager see both plants", () => {
    for (const role of ["ADMIN", "LOGISTICS_MANAGER"] as const) {
      expect(canAccessSite(role, null, LTN1)).toBe(true);
      expect(canAccessSite(role, null, LTN4)).toBe(true);
    }
  });

  it("denies access to a single-site user who has no site assigned", () => {
    // Failing closed: a misconfigured account sees nothing rather than everything.
    expect(canAccessSite("LTN1_STOREKEEPER", null, LTN1)).toBe(false);
  });
});
