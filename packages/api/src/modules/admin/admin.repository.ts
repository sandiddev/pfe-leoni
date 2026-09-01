import type { AuditListInput, UserListInput } from "@leoni/contracts";
import type { Role } from "@leoni/core";
import type { Prisma } from "@leoni/db";
import { db } from "@leoni/db";

import type { AuditEntry } from "../../shared/audit";

/**
 * Persistence for user administration and the audit log.
 *
 * A user edit is an audited write like any other master-data change: role and
 * plant decide what a person may do to the stock of two factories, so "who gave
 * them that, and when" has to be answerable. The `AuditLog` row is written in
 * the same transaction as the user row, never after it.
 */

const userSelection = {
  id: true,
  name: true,
  email: true,
  role: true,
  siteId: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelection }>;

export async function findUsers(input: UserListInput): Promise<UserRow[]> {
  const where: Prisma.UserWhereInput = {};

  if (!input.includeInactive) where.isActive = true;
  if (input.role !== undefined) where.role = input.role;
  if (input.search !== undefined && input.search !== "") {
    where.OR = [
      { name: { contains: input.search, mode: "insensitive" } },
      { email: { contains: input.search, mode: "insensitive" } },
    ];
  }

  return db.user.findMany({
    where,
    select: userSelection,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function findUserById(userId: string): Promise<UserRow | null> {
  return db.user.findUnique({ where: { id: userId }, select: userSelection });
}

export async function findSites() {
  return db.site.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
}

export interface UpdateUserData {
  readonly role: Role;
  readonly siteId: string | null;
  readonly isActive: boolean;
}

export interface UpdateUserOptions {
  readonly userId: string;
  readonly data: UpdateUserData;
  /** Built by the service. Written in the same transaction as the row. */
  readonly audit: AuditEntry;
}

/**
 * Changes what a person may do, and records who changed it.
 *
 * One transaction, for the same reason every other audited write is: a role
 * change whose log entry failed to write is a privilege nobody can account for,
 * and it is exactly the kind of thing an audit is run to find.
 */
export async function updateUserWithAudit(options: UpdateUserOptions): Promise<void> {
  await db.$transaction([
    db.user.update({ where: { id: options.userId }, data: options.data }),
    db.auditLog.create({ data: auditData(options.audit) }),
  ]);
}

/** Nullable Json columns need Prisma's explicit null, not a bare `null`. */
function auditData(audit: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
  return {
    entity: audit.entity,
    entityId: audit.entityId,
    action: audit.action,
    before: audit.before ?? { equals: null },
    after: audit.after ?? { equals: null },
    actorId: audit.actorId,
  };
}

export async function findUserByEmail(email: string) {
  return db.user.findUnique({ where: { email }, select: { id: true } });
}

export interface CreateUserOptions {
  readonly userId: string;
  readonly data: {
    readonly name: string;
    readonly email: string;
    readonly role: Role;
    readonly siteId: string | null;
  };
  /** Built by `@leoni/auth`; the password inside is already hashed. */
  readonly account: {
    readonly providerId: string;
    readonly issuer: string;
    readonly accountId: string;
    readonly password: string;
  };
  readonly audit: AuditEntry;
}

/**
 * Creates a user, the credential row that lets them sign in, and the trail.
 *
 * All three together. A `User` without its `Account` is a person who exists in
 * every list and cannot log in — and because the row looks perfectly correct
 * in Adminer, that failure is diagnosed by elimination rather than by reading.
 */
export async function createUserWithAudit(options: CreateUserOptions): Promise<void> {
  await db.$transaction([
    db.user.create({
      data: {
        id: options.userId,
        ...options.data,
        // No mail server is guaranteed on the LEONI network (brief 6.2), so a
        // provisioned account is trusted from the start rather than blocked
        // behind a verification link nobody will receive.
        emailVerified: true,
        isActive: true,
        accounts: { create: { ...options.account } },
      },
    }),
    db.auditLog.create({ data: auditData(options.audit) }),
  ]);
}

export interface ResetPasswordOptions {
  readonly userId: string;
  readonly account: {
    readonly providerId: string;
    readonly issuer: string;
    readonly accountId: string;
    readonly password: string;
  };
  readonly audit: AuditEntry;
}

/**
 * Replaces the stored password, and ends every open session.
 *
 * The session deletion is the point. A reset that leaves existing sessions
 * alive does not lock anybody out, which is the one thing a password reset is
 * for when an account is suspected compromised.
 */
export async function resetPasswordWithAudit(options: ResetPasswordOptions): Promise<void> {
  await db.$transaction([
    db.account.updateMany({
      where: { userId: options.userId, providerId: options.account.providerId },
      data: { password: options.account.password },
    }),
    db.session.deleteMany({ where: { userId: options.userId } }),
    db.auditLog.create({ data: auditData(options.audit) }),
  ]);
}

export async function findAuditEntries(input: AuditListInput) {
  const where: Prisma.AuditLogWhereInput = {};

  if (input.entity !== undefined && input.entity !== "") where.entity = input.entity;
  if (input.actorId !== undefined) where.actorId = input.actorId;
  if (input.from !== undefined || input.to !== undefined) {
    where.occurredAt = {
      ...(input.from === undefined ? {} : { gte: input.from }),
      ...(input.to === undefined ? {} : { lte: input.to }),
    };
  }

  const [rows, totalCount] = await db.$transaction([
    db.auditLog.findMany({
      where,
      select: {
        id: true,
        entity: true,
        entityId: true,
        action: true,
        before: true,
        after: true,
        occurredAt: true,
        actor: { select: { name: true } },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor === undefined || input.cursor === null
        ? {}
        : { cursor: { id: input.cursor }, skip: 1 }),
    }),
    db.auditLog.count({ where }),
  ]);

  return { rows, totalCount };
}

export type AuditRow = Awaited<ReturnType<typeof findAuditEntries>>["rows"][number];

/** The distinct entities present, so the filter offers only what exists. */
export async function findAuditedEntities(): Promise<readonly string[]> {
  const grouped = await db.auditLog.groupBy({ by: ["entity"], orderBy: { entity: "asc" } });
  return grouped.map((group) => group.entity);
}

export const adminRepository = {
  findUsers,
  findUserById,
  findUserByEmail,
  createUserWithAudit,
  resetPasswordWithAudit,
  findSites,
  updateUserWithAudit,
  findAuditEntries,
  findAuditedEntities,
};

export type AdminRepository = typeof adminRepository;
