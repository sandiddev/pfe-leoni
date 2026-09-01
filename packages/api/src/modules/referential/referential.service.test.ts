import { describe, expect, it } from "vitest";

import { NotFoundError } from "@leoni/core";

import type { Actor } from "../../context";
import type {
  CreateLocationOptions,
  CreateSiteOptions,
  DeleteLocationOptions,
  LocationRow,
  ReferentialRepository,
  SiteRow,
  UpdateLocationOptions,
} from "./referential.repository";
import * as service from "./referential.service";

/**
 * Plant master data, without a database.
 *
 * The two rules worth pinning are the ones the schema would otherwise enforce
 * in a language nobody in the warehouse reads: a shelf holding stock cannot be
 * removed, and a site's direction cannot flip once requests depend on it.
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

function stubRepository(overrides: Partial<ReferentialRepository> = {}): ReferentialRepository {
  const notStubbed = (name: string) => () => {
    throw new Error(`${name} was called but not stubbed in this test.`);
  };

  return {
    findSites: async () => [],
    findSiteById: notStubbed("findSiteById"),
    findSiteByCode: async () => null,
    createSiteWithAudit: async () => undefined,
    updateSiteWithAudit: async () => undefined,
    findLocations: async () => [],
    findLocationById: notStubbed("findLocationById"),
    findLocationByCode: async () => null,
    createLocationWithAudit: async () => undefined,
    updateLocationWithAudit: async () => undefined,
    deleteLocationWithAudit: async () => undefined,
    ...overrides,
  };
}

function siteRow(overrides: Partial<SiteRow> = {}): SiteRow {
  return {
    id: LTN1,
    code: "LTN1",
    name: "LEONI Tunisie 1",
    type: "CONSUMING",
    _count: { storageLocations: 4, requestsFrom: 0, requestsTo: 0 },
    ...overrides,
  };
}

function locationRow(overrides: Partial<LocationRow> = {}): LocationRow {
  return {
    id: "loc-1",
    code: "A-01",
    description: "Rayon A, niveau 1",
    siteId: LTN1,
    site: { code: "LTN1" },
    lots: [],
    ...overrides,
  };
}

/**
 * Records what the service handed the repository.
 *
 * An array rather than `let captured = null`: TypeScript narrows a variable
 * only ever assigned inside a closure to `never`, and the assertion below then
 * cannot read a field off it.
 */
function capture<TOptions>() {
  const calls: TOptions[] = [];

  return {
    record: async (options: TOptions) => {
      calls.push(options);
    },
    first: () => {
      const first = calls[0];
      if (first === undefined) throw new Error("the repository method was never called.");
      return first;
    },
  };
}

/** `findSiteById` returns a narrower shape than the list row. */
function siteDetail(overrides: Partial<{ type: "CONSUMING" | "SUPPLYING"; requests: number }> = {}) {
  const { type = "CONSUMING", requests = 0 } = overrides;

  return {
    id: LTN1,
    code: "LTN1",
    name: "LEONI Tunisie 1",
    type,
    _count: { requestsFrom: requests, requestsTo: 0 },
  };
}

describe("sites", () => {
  it("reports how many shelves and requests each site carries", async () => {
    const sites = await service.listSites({
      actor: actor(),
      repository: stubRepository({
        findSites: async () => [siteRow({ _count: { storageLocations: 4, requestsFrom: 3, requestsTo: 7 } })],
      }),
    });

    expect(sites[0]).toMatchObject({ code: "LTN1", locationCount: 4, requestCount: 10 });
  });

  it("refuses a code that already exists", async () => {
    await expect(
      service.createSite({
        actor: actor(),
        input: { code: "LTN1", name: "Doublon", type: "CONSUMING" },
        repository: stubRepository({ findSiteByCode: async () => ({ id: LTN1 }) }),
      }),
    ).rejects.toThrow(/existe deja/i);
  });

  it("records a created site with no before-image", async () => {
    const written = capture<CreateSiteOptions>();

    await service.createSite({
      actor: actor(),
      input: { code: "LTN7", name: "LEONI Tunisie 7", type: "SUPPLYING" },
      repository: stubRepository({ createSiteWithAudit: written.record }),
    });

    expect(written.first().audit.action).toBe("CREATE");
    expect(written.first().audit.before).toBeNull();
    expect(written.first().audit.after).toEqual({
      code: "LTN7",
      name: "LEONI Tunisie 7",
      type: "SUPPLYING",
    });
  });

  it("renames a site freely", async () => {
    await expect(
      service.updateSite({
        actor: actor(),
        input: { siteId: LTN1, name: "Nouveau nom", type: "CONSUMING" },
        repository: stubRepository({ findSiteById: async () => siteDetail({ requests: 12 }) }),
      }),
    ).resolves.toEqual({ siteId: LTN1 });
  });

  it("refuses to flip the direction of a site that requests depend on", async () => {
    // resolveTransferSites reads the type to decide which plant supplies.
    // Flipping it would reverse transfers already in flight.
    await expect(
      service.updateSite({
        actor: actor(),
        input: { siteId: LTN1, name: "LEONI Tunisie 1", type: "SUPPLYING" },
        repository: stubRepository({ findSiteById: async () => siteDetail({ requests: 12 }) }),
      }),
    ).rejects.toThrow(/sens du transfert/i);
  });

  it("allows the direction to change while no request references the site", async () => {
    await expect(
      service.updateSite({
        actor: actor(),
        input: { siteId: LTN1, name: "LEONI Tunisie 1", type: "SUPPLYING" },
        repository: stubRepository({ findSiteById: async () => siteDetail({ requests: 0 }) }),
      }),
    ).resolves.toEqual({ siteId: LTN1 });
  });

  it("reports an unknown site as not found", async () => {
    await expect(
      service.updateSite({
        actor: actor(),
        input: { siteId: "gone", name: "X", type: "CONSUMING" },
        repository: stubRepository({ findSiteById: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("storage locations", () => {
  it("reports what each shelf is holding", async () => {
    const locations = await service.listLocations({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findLocations: async () => [locationRow({ lots: [{ quantity: 400 }, { quantity: 800 }] })],
      }),
    });

    expect(locations[0]).toMatchObject({ code: "A-01", lotCount: 2, totalQuantity: 1_200 });
  });

  it("scopes the shelf list to the actor's plant", async () => {
    let seenSiteId: string | null | undefined;

    await service.listLocations({
      actor: actor({ role: "LTN1_STOREKEEPER", siteId: LTN1 }),
      input: {},
      repository: stubRepository({
        findLocations: async (siteId) => {
          seenSiteId = siteId;
          return [];
        },
      }),
    });

    expect(seenSiteId).toBe(LTN1);
  });

  it("refuses to create a shelf on another plant", async () => {
    await expect(
      service.createLocation({
        actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
        input: { siteId: LTN1, code: "A-02" },
        repository: stubRepository(),
      }),
    ).rejects.toThrow(/donnees de ce site/i);
  });

  it("refuses a code already used on the same plant", async () => {
    await expect(
      service.createLocation({
        actor: actor(),
        input: { siteId: LTN1, code: "A-01" },
        repository: stubRepository({ findLocationByCode: async () => ({ id: "loc-1" }) }),
      }),
    ).rejects.toThrow(/existe deja/i);
  });

  it("records a created shelf against its plant", async () => {
    const written = capture<CreateLocationOptions>();

    await service.createLocation({
      actor: actor(),
      input: { siteId: LTN1, code: "B-07", description: "Rayon B" },
      repository: stubRepository({ createLocationWithAudit: written.record }),
    });

    expect(written.first().siteId).toBe(LTN1);
    expect(written.first().data).toEqual({ code: "B-07", description: "Rayon B" });
    expect(written.first().audit.action).toBe("CREATE");
  });

  it("deletes an empty shelf and keeps a record that it existed", async () => {
    const written = capture<DeleteLocationOptions>();

    await service.deleteLocation({
      actor: actor(),
      input: { storageLocationId: "loc-1" },
      repository: stubRepository({
        findLocationById: async () => ({ ...locationRow(), lots: [] }),
        deleteLocationWithAudit: written.record,
      }),
    });

    // Once the row is gone, the audit entry is the only evidence it was there.
    expect(written.first().audit.action).toBe("DELETE");
    expect(written.first().audit.before).toMatchObject({ code: "A-01" });
  });

  it("refuses to delete a shelf that still holds stock, and says what is on it", async () => {
    await expect(
      service.deleteLocation({
        actor: actor(),
        input: { storageLocationId: "loc-1" },
        repository: stubRepository({
          findLocationById: async () => ({
            ...locationRow(),
            lots: [{ quantity: 400 }, { quantity: 800 }],
          }),
        }),
      }),
    ).rejects.toThrow(/2 lot\(s\) soit 1200 unites/i);
  });

  it("refuses to delete a shelf on another plant", async () => {
    await expect(
      service.deleteLocation({
        actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
        input: { storageLocationId: "loc-1" },
        repository: stubRepository({ findLocationById: async () => locationRow() }),
      }),
    ).rejects.toThrow(/donnees de ce site/i);
  });

  it("reports an unknown shelf as not found", async () => {
    await expect(
      service.deleteLocation({
        actor: actor(),
        input: { storageLocationId: "gone" },
        repository: stubRepository({ findLocationById: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("renames a shelf and records both sides", async () => {
    const written = capture<UpdateLocationOptions>();

    await service.updateLocation({
      actor: actor(),
      input: { storageLocationId: "loc-1", code: "A-99", description: "Deplace" },
      repository: stubRepository({
        findLocationById: async () => locationRow(),
        updateLocationWithAudit: written.record,
      }),
    });

    expect(written.first().audit.before).toMatchObject({ code: "A-01" });
    expect(written.first().audit.after).toMatchObject({ code: "A-99", description: "Deplace" });
  });

  it("clears a description that was removed rather than leaving the old one", async () => {
    const written = capture<UpdateLocationOptions>();

    await service.updateLocation({
      actor: actor(),
      input: { storageLocationId: "loc-1", code: "A-01" },
      repository: stubRepository({
        findLocationById: async () => locationRow(),
        updateLocationWithAudit: written.record,
      }),
    });

    expect(written.first().data.description).toBeNull();
  });

  it("refuses an unknown shelf on rename", async () => {
    await expect(
      service.updateLocation({
        actor: actor(),
        input: { storageLocationId: "gone", code: "X" },
        repository: stubRepository({ findLocationById: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
