import { describe, expect, it } from "vitest";

import { isPermission } from "./permission";
import { canAll, canAny } from "./permissions";
import { CROSS_SITE_ROLES, isCrossSiteRole, isRole, ROLES } from "./role";

describe("role and permission guards", () => {
  it("recognises the five actors of the process", () => {
    expect(ROLES).toHaveLength(5);
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
  });

  it("rejects a value that is not a role", () => {
    // Guards the boundary where a role arrives as a plain string from the
    // session or from a CSV import.
    expect(isRole("SUPERVISOR")).toBe(false);
    expect(isRole("")).toBe(false);
  });

  it("recognises a permission", () => {
    expect(isPermission("request:approve")).toBe(true);
    expect(isPermission("request:teleport")).toBe(false);
  });

  it("identifies the two cross-site roles", () => {
    expect(CROSS_SITE_ROLES).toStrictEqual(["ADMIN", "LOGISTICS_MANAGER"]);
    expect(isCrossSiteRole("ADMIN")).toBe(true);
    expect(isCrossSiteRole("LOGISTICS_MANAGER")).toBe(true);
    expect(isCrossSiteRole("LTN1_STOREKEEPER")).toBe(false);
    expect(isCrossSiteRole("LTN4_RESPONSIBLE")).toBe(false);
  });
});

describe("canAll and canAny", () => {
  it("requires every permission for canAll", () => {
    expect(canAll("LTN1_STOREKEEPER", ["request:create", "request:receive"])).toBe(true);
    expect(canAll("LTN1_STOREKEEPER", ["request:create", "request:approve"])).toBe(false);
  });

  it("requires only one permission for canAny", () => {
    expect(canAny("LTN1_STOREKEEPER", ["request:approve", "request:create"])).toBe(true);
    expect(canAny("LTN1_STOREKEEPER", ["request:approve", "user:write"])).toBe(false);
  });

  it("treats an empty requirement as satisfied by canAll and unsatisfied by canAny", () => {
    expect(canAll("LOGISTICS_MANAGER", [])).toBe(true);
    expect(canAny("LOGISTICS_MANAGER", [])).toBe(false);
  });
});
