import { describe, expect, it } from "vitest";

import { BusinessRuleError, NotFoundError } from "@leoni/core";

import type { Actor } from "../../context";
import type {
  AdminRepository,
  AuditRow,
  CreateUserOptions,
  ResetPasswordOptions,
  UpdateUserOptions,
  UserRow,
} from "./admin.repository";
import * as service from "./admin.service";

/**
 * User administration, without a database.
 *
 * Two of these tests exist because of a specific evening: an administrator who
 * demotes their own account leaves nobody able to undo it without a psql
 * prompt, and a single-site role saved with no plant fails closed and sees
 * nothing. Both are refused here rather than discovered in production.
 */

const LTN1 = "site-ltn1";
const LTN4 = "site-ltn4";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "user-admin",
    name: "Admin",
    email: "admin@leoni.tn",
    role: "ADMIN",
    siteId: null,
    ...overrides,
  };
}

function stubRepository(overrides: Partial<AdminRepository> = {}): AdminRepository {
  const notStubbed = (name: string) => () => {
    throw new Error(`${name} was called but not stubbed in this test.`);
  };

  return {
    findUsers: async () => [],
    findUserById: notStubbed("findUserById"),
    findUserByEmail: async () => null,
    createUserWithAudit: async () => undefined,
    resetPasswordWithAudit: async () => undefined,
    findSites: async () => [
      { id: LTN1, code: "LTN1", name: "LEONI Tunisie 1" },
      { id: LTN4, code: "LTN4", name: "LEONI Tunisie 4" },
    ],
    updateUserWithAudit: async () => undefined,
    findAuditEntries: notStubbed("findAuditEntries"),
    findAuditedEntities: async () => [],
    ...overrides,
  };
}

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-1",
    name: "Magasinier",
    email: "magasinier.ltn1@leoni.tn",
    role: "LTN1_STOREKEEPER",
    siteId: LTN1,
    isActive: true,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function captureUpdates() {
  const calls: UpdateUserOptions[] = [];
  return {
    capture: async (options: UpdateUserOptions) => {
      calls.push(options);
    },
    first: () => {
      const first = calls[0];
      if (first === undefined) throw new Error("updateUserWithAudit was never called.");
      return first;
    },
  };
}

const listInput = { includeInactive: true } as const;

describe("user list", () => {
  it("resolves each user's plant to its code", async () => {
    const users = await service.listUsers({
      actor: actor(),
      input: listInput,
      repository: stubRepository({ findUsers: async () => [userRow()] }),
    });

    expect(users[0]?.siteCode).toBe("LTN1");
  });

  it("shows no plant for a cross-site account", async () => {
    const users = await service.listUsers({
      actor: actor(),
      input: listInput,
      repository: stubRepository({
        findUsers: async () => [userRow({ role: "LOGISTICS_MANAGER", siteId: null })],
      }),
    });

    expect(users[0]?.siteCode).toBeNull();
  });

  it("lists the plants an account can be attached to", async () => {
    const sites = await service.listSites({ actor: actor(), repository: stubRepository() });

    expect(sites.map((site) => site.code)).toEqual(["LTN1", "LTN4"]);
  });
});

describe("user update", () => {
  it("records both sides of a role change", async () => {
    const written = captureUpdates();

    await service.updateUser({
      actor: actor(),
      input: { userId: "user-1", role: "LTN1_WAREHOUSE_MANAGER", siteId: LTN1, isActive: true },
      repository: stubRepository({
        findUserById: async () => userRow(),
        updateUserWithAudit: written.capture,
      }),
    });

    const options = written.first();
    expect(options.audit.entity).toBe("User");
    expect(options.audit.before).toEqual({
      role: "LTN1_STOREKEEPER",
      siteId: LTN1,
      isActive: true,
    });
    expect(options.audit.after).toEqual({
      role: "LTN1_WAREHOUSE_MANAGER",
      siteId: LTN1,
      isActive: true,
    });
    expect(options.audit.actorId).toBe("user-admin");
  });

  it("clears the plant when the role spans both", async () => {
    // Storing one would be a lie the scoping middleware then has to ignore.
    const written = captureUpdates();

    await service.updateUser({
      actor: actor(),
      input: { userId: "user-1", role: "LOGISTICS_MANAGER", siteId: LTN1, isActive: true },
      repository: stubRepository({
        findUserById: async () => userRow(),
        updateUserWithAudit: written.capture,
      }),
    });

    expect(written.first().data.siteId).toBeNull();
  });

  it("refuses a single-site role with no plant", async () => {
    await expect(
      service.updateUser({
        actor: actor(),
        input: { userId: "user-1", role: "LTN4_RESPONSIBLE", siteId: null, isActive: true },
        repository: stubRepository({ findUserById: async () => userRow() }),
      }),
    ).rejects.toThrow(BusinessRuleError);
  });

  it("refuses an administrator deactivating their own account", async () => {
    await expect(
      service.updateUser({
        actor: actor({ userId: "user-admin" }),
        input: { userId: "user-admin", role: "ADMIN", siteId: null, isActive: false },
        repository: stubRepository({
          findUserById: async () => userRow({ id: "user-admin", role: "ADMIN", siteId: null }),
        }),
      }),
    ).rejects.toThrow(/votre propre role/i);
  });

  it("refuses an administrator demoting themselves", async () => {
    await expect(
      service.updateUser({
        actor: actor({ userId: "user-admin" }),
        input: { userId: "user-admin", role: "LTN1_STOREKEEPER", siteId: LTN1, isActive: true },
        repository: stubRepository({
          findUserById: async () => userRow({ id: "user-admin", role: "ADMIN", siteId: null }),
        }),
      }),
    ).rejects.toThrow(BusinessRuleError);
  });

  it("lets an administrator edit their own name-neutral fields unchanged", async () => {
    // Saving the row without changing role or access is not a lockout risk.
    const written = captureUpdates();

    await service.updateUser({
      actor: actor({ userId: "user-admin" }),
      input: { userId: "user-admin", role: "ADMIN", siteId: null, isActive: true },
      repository: stubRepository({
        findUserById: async () => userRow({ id: "user-admin", role: "ADMIN", siteId: null }),
        updateUserWithAudit: written.capture,
      }),
    });

    expect(written.first().userId).toBe("user-admin");
  });

  it("deactivates somebody else's account rather than deleting it", async () => {
    const written = captureUpdates();

    await service.updateUser({
      actor: actor(),
      input: { userId: "user-1", role: "LTN1_STOREKEEPER", siteId: LTN1, isActive: false },
      repository: stubRepository({
        findUserById: async () => userRow(),
        updateUserWithAudit: written.capture,
      }),
    });

    expect(written.first().data.isActive).toBe(false);
  });

  it("reports an unknown user as not found", async () => {
    await expect(
      service.updateUser({
        actor: actor(),
        input: { userId: "gone", role: "ADMIN", siteId: null, isActive: true },
        repository: stubRepository({ findUserById: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("user provisioning", () => {
  function captureCreate() {
    const calls: CreateUserOptions[] = [];
    return {
      record: async (options: CreateUserOptions) => {
        calls.push(options);
      },
      first: () => {
        const first = calls[0];
        if (first === undefined) throw new Error("createUserWithAudit was never called.");
        return first;
      },
    };
  }

  const input = {
    name: "Sami Ben Ali",
    email: "sami.benali@leoni.tn",
    role: "LTN1_STOREKEEPER",
    siteId: LTN1,
  } as const;

  it("returns a password, once", async () => {
    const result = await service.createUser({
      actor: actor(),
      input,
      repository: stubRepository(),
    });

    expect(result.email).toBe("sami.benali@leoni.tn");
    expect(result.password.length).toBeGreaterThanOrEqual(12);
  });

  it("creates the credential row alongside the user", async () => {
    // A User with no Account is a person who exists in every list and cannot
    // sign in, and the row looks perfectly correct in the database.
    const written = captureCreate();

    await service.createUser({
      actor: actor(),
      input,
      repository: stubRepository({ createUserWithAudit: written.record }),
    });

    const account = written.first().account;
    expect(account.providerId).toBe("credential");
    expect(account.accountId).toBe(written.first().userId);
    expect(account.issuer.length).toBeGreaterThan(0);
  });

  it("stores a hash, never the password itself", async () => {
    const written = captureCreate();

    const result = await service.createUser({
      actor: actor(),
      input,
      repository: stubRepository({ createUserWithAudit: written.record }),
    });

    expect(written.first().account.password).not.toBe(result.password);
    expect(written.first().account.password).not.toContain(result.password);
  });

  it("keeps the password out of the audit trail entirely", async () => {
    // The audit log is readable by the Logistics Manager. A credential in it
    // would make the log a credential store with a friendly name.
    const written = captureCreate();

    const result = await service.createUser({
      actor: actor(),
      input,
      repository: stubRepository({ createUserWithAudit: written.record }),
    });

    expect(JSON.stringify(written.first().audit)).not.toContain(result.password);
    expect(written.first().audit.action).toBe("CREATE");
  });

  it("generates a different password every time", async () => {
    const first = await service.createUser({ actor: actor(), input, repository: stubRepository() });
    const second = await service.createUser({
      actor: actor(),
      input,
      repository: stubRepository(),
    });

    expect(first.password).not.toBe(second.password);
  });

  it("refuses an address that already has an account", async () => {
    await expect(
      service.createUser({
        actor: actor(),
        input,
        repository: stubRepository({ findUserByEmail: async () => ({ id: "user-1" }) }),
      }),
    ).rejects.toThrow(/existe deja/i);
  });

  it("refuses a single-site role with no plant", async () => {
    await expect(
      service.createUser({
        actor: actor(),
        input: { ...input, siteId: null },
        repository: stubRepository(),
      }),
    ).rejects.toThrow(BusinessRuleError);
  });

  it("clears the plant for a role that spans both", async () => {
    const written = captureCreate();

    await service.createUser({
      actor: actor(),
      input: { ...input, role: "LOGISTICS_MANAGER", siteId: LTN1 },
      repository: stubRepository({ createUserWithAudit: written.record }),
    });

    expect(written.first().data.siteId).toBeNull();
  });

  it("issues a new password on reset", async () => {
    const calls: ResetPasswordOptions[] = [];

    const result = await service.resetPassword({
      actor: actor(),
      input: { userId: "user-1" },
      repository: stubRepository({
        findUserById: async () => userRow(),
        resetPasswordWithAudit: async (options) => {
          calls.push(options);
        },
      }),
    });

    expect(result.password.length).toBeGreaterThanOrEqual(12);
    expect(calls[0]?.account.password).not.toBe(result.password);
    expect(calls[0]?.audit.action).toBe("RESET_PASSWORD");
    expect(JSON.stringify(calls[0]?.audit)).not.toContain(result.password);
  });

  it("reports an unknown user on reset", async () => {
    await expect(
      service.resetPassword({
        actor: actor(),
        input: { userId: "gone" },
        repository: stubRepository({ findUserById: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("audit log", () => {
  it("lists only the fields that actually changed", async () => {
    // An entry listing five values of which one moved makes the reader hunt.
    const page = await service.listAudit({
      actor: actor(),
      input: { limit: 25, cursor: null },
      repository: stubRepository({
        findAuditEntries: async () => ({
          rows: [
            auditRow({
              before: { role: "LTN1_STOREKEEPER", siteId: LTN1, isActive: true },
              after: { role: "LTN1_WAREHOUSE_MANAGER", siteId: LTN1, isActive: true },
            }),
          ],
          totalCount: 1,
        }),
      }),
    });

    expect(page.items[0]?.changes).toEqual([
      { field: "role", before: "LTN1_STOREKEEPER", after: "LTN1_WAREHOUSE_MANAGER" },
    ]);
  });

  it("renders a creation as fields appearing from nothing", async () => {
    const page = await service.listAudit({
      actor: actor(),
      input: { limit: 25, cursor: null },
      repository: stubRepository({
        findAuditEntries: async () => ({
          rows: [auditRow({ action: "CREATE", before: null, after: { safetyDays: 2 } })],
          totalCount: 1,
        }),
      }),
    });

    expect(page.items[0]?.changes).toEqual([{ field: "safetyDays", before: null, after: "2" }]);
  });

  it("writes a boolean as a readable value rather than dropping it", async () => {
    const page = await service.listAudit({
      actor: actor(),
      input: { limit: 25, cursor: null },
      repository: stubRepository({
        findAuditEntries: async () => ({
          rows: [auditRow({ before: { isActive: true }, after: { isActive: false } })],
          totalCount: 1,
        }),
      }),
    });

    expect(page.items[0]?.changes).toEqual([
      { field: "isActive", before: "true", after: "false" },
    ]);
  });

  it("survives a payload that is not an object at all", async () => {
    const page = await service.listAudit({
      actor: actor(),
      input: { limit: 25, cursor: null },
      repository: stubRepository({
        findAuditEntries: async () => ({
          rows: [auditRow({ before: "corrupted", after: 42 })],
          totalCount: 1,
        }),
      }),
    });

    expect(page.items[0]?.changes).toEqual([]);
  });

  it("names the author, and says so when there was none", async () => {
    const page = await service.listAudit({
      actor: actor(),
      input: { limit: 25, cursor: null },
      repository: stubRepository({
        findAuditEntries: async () => ({
          rows: [auditRow({ actor: null })],
          totalCount: 1,
        }),
      }),
    });

    // Null is the nightly job or an import, and must not be attributed.
    expect(page.items[0]?.actorName).toBeNull();
  });

  it("keeps the extra pagination row out of the page", async () => {
    const page = await service.listAudit({
      actor: actor(),
      input: { limit: 1, cursor: null },
      repository: stubRepository({
        findAuditEntries: async () => ({
          rows: [auditRow({ id: "a" }), auditRow({ id: "b" })],
          totalCount: 2,
        }),
      }),
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("a");
  });

  it("offers only the entities that appear in the log", async () => {
    const entities = await service.listAuditedEntities({
      actor: actor(),
      repository: stubRepository({
        findAuditedEntities: async () => ["Article", "ReplenishmentParameter", "User"],
      }),
    });

    expect(entities).toEqual(["Article", "ReplenishmentParameter", "User"]);
  });
});

function auditRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "audit-1",
    entity: "User",
    entityId: "user-1",
    action: "UPDATE",
    before: null,
    after: null,
    occurredAt: new Date("2026-03-01"),
    actor: { name: "Admin" },
    ...overrides,
  };
}
