import type {
  CreateLocationInput,
  CreateSiteInput,
  DeleteLocationInput,
  LocationItem,
  LocationListInput,
  SiteItem,
  UpdateLocationInput,
  UpdateSiteInput,
} from "@leoni/contracts";
import { BusinessRuleError, NotFoundError } from "@leoni/core";

import type { Actor } from "../../context";
import { assertCanAccessSite, resolveSiteFilter } from "../../middlewares/site-scope";
import type { AuditPayload } from "../../shared/audit";
import * as mapper from "./referential.mapper";
import type { ReferentialRepository } from "./referential.repository";
import { referentialRepository } from "./referential.repository";

/**
 * Business rules for plant master data.
 *
 * Two of them exist because the database would otherwise refuse in a language
 * nobody in the warehouse reads. `onDelete: Restrict` on `StockLot` turns a
 * delete on an occupied shelf into a foreign-key error and a 500; the check
 * below turns it into a sentence naming what is on it.
 */

interface ServiceParams<TInput> {
  readonly actor: Actor;
  readonly input: TInput;
  /** Injected by the tests. Defaults to the Prisma-backed repository. */
  readonly repository?: ReferentialRepository;
}

export async function listSites({
  repository = referentialRepository,
}: {
  readonly actor: Actor;
  readonly repository?: ReferentialRepository;
}): Promise<readonly SiteItem[]> {
  const rows = await repository.findSites();
  return rows.map(mapper.toSiteItem);
}

function sitePayload(data: { code: string; name: string; type: string }): AuditPayload {
  return { code: data.code, name: data.name, type: data.type };
}

export async function createSite({
  actor,
  input,
  repository = referentialRepository,
}: ServiceParams<CreateSiteInput>): Promise<{ siteId: string }> {
  const existing = await repository.findSiteByCode(input.code);

  if (existing !== null) {
    throw new BusinessRuleError(`Le site ${input.code} existe deja.`, { code: input.code });
  }

  const siteId = crypto.randomUUID();

  await repository.createSiteWithAudit({
    siteId,
    data: { code: input.code, name: input.name, type: input.type },
    audit: {
      entity: "Site",
      entityId: siteId,
      action: "CREATE",
      before: null,
      after: sitePayload(input),
      actorId: actor.userId,
    },
  });

  return { siteId };
}

/**
 * Renames a site, or changes which end of a transfer it is.
 *
 * The code is immutable: it is printed on labels and quoted on the phone, and
 * every screen identifies a plant by it.
 *
 * The type is immutable *once requests exist*. `resolveTransferSites` reads it
 * to decide which plant supplies and which consumes, so flipping it under a
 * live workflow would reverse the direction of transfers already in flight —
 * and silently reinterpret every closed one in the history.
 */
export async function updateSite({
  actor,
  input,
  repository = referentialRepository,
}: ServiceParams<UpdateSiteInput>): Promise<{ siteId: string }> {
  const existing = await repository.findSiteById(input.siteId);

  if (existing === null) {
    throw new NotFoundError(`Site introuvable : ${input.siteId}`, { siteId: input.siteId });
  }

  const requestCount = existing._count.requestsFrom + existing._count.requestsTo;

  if (input.type !== existing.type && requestCount > 0) {
    throw new BusinessRuleError(
      `Le type du site ${existing.code} ne peut plus changer : ${String(requestCount)} demande(s) ` +
        "s appuient dessus pour determiner le sens du transfert.",
      { siteId: input.siteId, requestCount },
    );
  }

  await repository.updateSiteWithAudit({
    siteId: input.siteId,
    data: { name: input.name, type: input.type },
    audit: {
      entity: "Site",
      entityId: input.siteId,
      action: "UPDATE",
      before: sitePayload(existing),
      after: sitePayload({ code: existing.code, name: input.name, type: input.type }),
      actorId: actor.userId,
    },
  });

  return { siteId: input.siteId };
}

export async function listLocations({
  actor,
  input,
  repository = referentialRepository,
}: ServiceParams<LocationListInput>): Promise<readonly LocationItem[]> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const rows = await repository.findLocations(siteId);
  return rows.map(mapper.toLocationItem);
}

function locationPayload(data: {
  code: string;
  description: string | null;
  siteId: string;
}): AuditPayload {
  return { code: data.code, description: data.description, siteId: data.siteId };
}

export async function createLocation({
  actor,
  input,
  repository = referentialRepository,
}: ServiceParams<CreateLocationInput>): Promise<{ storageLocationId: string }> {
  // A shelf belongs to a plant, so creating one is a write against that plant.
  assertCanAccessSite(actor, input.siteId);

  const existing = await repository.findLocationByCode(input.siteId, input.code);

  if (existing !== null) {
    throw new BusinessRuleError(`L emplacement ${input.code} existe deja sur ce site.`, {
      code: input.code,
    });
  }

  const storageLocationId = crypto.randomUUID();
  const data = { code: input.code, description: input.description ?? null };

  await repository.createLocationWithAudit({
    storageLocationId,
    siteId: input.siteId,
    data,
    audit: {
      entity: "StorageLocation",
      entityId: storageLocationId,
      action: "CREATE",
      before: null,
      after: locationPayload({ ...data, siteId: input.siteId }),
      actorId: actor.userId,
    },
  });

  return { storageLocationId };
}

export async function updateLocation({
  actor,
  input,
  repository = referentialRepository,
}: ServiceParams<UpdateLocationInput>): Promise<{ storageLocationId: string }> {
  const existing = await repository.findLocationById(input.storageLocationId);

  if (existing === null) {
    throw new NotFoundError(`Emplacement introuvable : ${input.storageLocationId}`, {
      storageLocationId: input.storageLocationId,
    });
  }

  assertCanAccessSite(actor, existing.siteId);

  const data = { code: input.code, description: input.description ?? null };

  await repository.updateLocationWithAudit({
    storageLocationId: input.storageLocationId,
    data,
    audit: {
      entity: "StorageLocation",
      entityId: input.storageLocationId,
      action: "UPDATE",
      before: locationPayload({ ...existing, siteId: existing.siteId }),
      after: locationPayload({ ...data, siteId: existing.siteId }),
      actorId: actor.userId,
    },
  });

  return { storageLocationId: input.storageLocationId };
}

/**
 * Removes an empty shelf.
 *
 * Refused while anything sits on it. The schema already says so with
 * `onDelete: Restrict`, but a foreign-key violation reaches the browser as an
 * internal error, and "impossible de supprimer : 3 lot(s), 1 200 unites"
 * tells the user what to do about it.
 */
export async function deleteLocation({
  actor,
  input,
  repository = referentialRepository,
}: ServiceParams<DeleteLocationInput>): Promise<void> {
  const existing = await repository.findLocationById(input.storageLocationId);

  if (existing === null) {
    throw new NotFoundError(`Emplacement introuvable : ${input.storageLocationId}`, {
      storageLocationId: input.storageLocationId,
    });
  }

  assertCanAccessSite(actor, existing.siteId);

  const quantity = existing.lots.reduce((sum, lot) => sum + lot.quantity, 0);

  // Any lot row blocks, empty or not. `onDelete: Restrict` on `StockLot` is
  // what the database enforces, and it counts rows rather than units — a
  // check that only looked at quantity would pass and then fail in Postgres.
  //
  // Exhausted lots are kept rather than swept: `StockMovement.lotId` is
  // `SetNull`, so removing them would quietly erase the location from every
  // historical journal line that went through this shelf.
  if (existing.lots.length > 0) {
    throw new BusinessRuleError(
      quantity > 0
        ? `L emplacement ${existing.code} contient encore ${String(existing.lots.length)} lot(s) ` +
          `soit ${String(quantity)} unites. Transferez le stock avant de le supprimer.`
        : `L emplacement ${existing.code} a ete utilise : ${String(existing.lots.length)} lot(s) ` +
          "epuise(s) y sont encore rattache(s) et servent a expliquer le journal des mouvements. " +
          "Un emplacement ayant recu du stock ne se supprime pas.",
      { storageLocationId: input.storageLocationId, lots: existing.lots.length, quantity },
    );
  }

  await repository.deleteLocationWithAudit({
    storageLocationId: input.storageLocationId,
    audit: {
      entity: "StorageLocation",
      entityId: input.storageLocationId,
      action: "DELETE",
      before: locationPayload({ ...existing, siteId: existing.siteId }),
      after: null,
      actorId: actor.userId,
    },
  });
}
