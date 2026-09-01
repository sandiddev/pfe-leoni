import type { AuditChange, AuditEntryItem, SiteOption, UserItem } from "@leoni/contracts";

import type { AuditRow, UserRow } from "./admin.repository";

/**
 * Rows to the DTOs the administration screen renders.
 *
 * The interesting work is turning an audit row's two JSON blobs into a list of
 * field-level changes. A log nobody can read is a log nobody consults, and
 * `{"role":"ADMIN"}` beside `{"role":"LTN1_STOREKEEPER"}` is a diff the reader
 * has to perform themselves.
 */

interface SiteRow {
  id: string;
  code: string;
  name: string;
}

export function toSiteOption(row: SiteRow): SiteOption {
  return { id: row.id, code: row.code, name: row.name };
}

export function toUserItem(row: UserRow, siteCodeById: ReadonlyMap<string, string>): UserItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    // No `isRole` guard here, unlike the session context: this value comes from
    // a Prisma enum column, so the database has already constrained it. The
    // guard would be a branch no test could reach.
    role: row.role,
    siteId: row.siteId,
    siteCode: row.siteId === null ? null : (siteCodeById.get(row.siteId) ?? null),
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

/** A JSON payload as a flat map of readable strings, or empty if it is not one. */
function toFieldMap(payload: unknown): ReadonlyMap<string, string | null> {
  if (typeof payload !== "object" || payload === null) return new Map();

  const entries = Object.entries(payload).map(([field, value]): [string, string | null] => {
    if (typeof value === "string") return [field, value];
    if (typeof value === "number" || typeof value === "boolean") return [field, String(value)];
    // Null, undefined, or a nested object. The last is a bug in the writer
    // rather than something to render: `AuditValue` is scalars only.
    return [field, null];
  });

  return new Map(entries);
}

/**
 * The fields that actually differ between the two sides.
 *
 * Unchanged fields are dropped: an audit entry listing five values of which one
 * moved makes the reader hunt for it, which is how a log stops being read.
 */
export function toChanges(before: unknown, after: unknown): readonly AuditChange[] {
  const beforeFields = toFieldMap(before);
  const afterFields = toFieldMap(after);

  const fields = [...new Set([...beforeFields.keys(), ...afterFields.keys()])].sort();

  return fields
    .map((field) => ({
      field,
      before: beforeFields.get(field) ?? null,
      after: afterFields.get(field) ?? null,
    }))
    .filter((change) => change.before !== change.after);
}

export function toAuditEntryItem(row: AuditRow): AuditEntryItem {
  return {
    id: row.id,
    entity: row.entity,
    entityId: row.entityId,
    action: row.action,
    actorName: row.actor?.name ?? null,
    occurredAt: row.occurredAt,
    changes: toChanges(row.before, row.after),
  };
}
