import { z } from "zod";

import type { Role } from "@leoni/core";

import { idSchema, paginationSchema, roleSchema, searchSchema } from "./common";

/**
 * User administration and the audit log (brief section 6.1).
 *
 * Creating an account is deliberately not part of this module: sign-up is
 * disabled in `@leoni/auth`, and the five demo accounts come from the seed. The
 * Administrator changes what an existing person may do; issuing credentials is
 * a different act with different risks, and the brief does not ask for it.
 */

export const userListInputSchema = z.object({
  search: searchSchema,
  role: roleSchema.optional(),
  includeInactive: z.boolean().default(true),
});

export type UserListInput = z.infer<typeof userListInputSchema>;

/**
 * Provisioning an account.
 *
 * No password field: the server generates one and returns it once. An
 * Administrator typing a password chooses a weak one and then has to transmit
 * it anyway; generating it means the only copy that ever existed is the one on
 * screen.
 */
export const createUserInputSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(120),
  email: z.email("Adresse e-mail invalide").trim().toLowerCase(),
  role: roleSchema,
  /** Null for the two cross-site roles, which span both plants. */
  siteId: idSchema.nullable(),
});

export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const resetPasswordInputSchema = z.object({ userId: idSchema });

export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

export const updateUserInputSchema = z.object({
  userId: idSchema,
  role: roleSchema,
  /** Null for the two cross-site roles, which span both plants. */
  siteId: idSchema.nullable(),
  isActive: z.boolean(),
});

export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export const auditListInputSchema = paginationSchema.extend({
  /** Prisma model name, e.g. "Article", "ReplenishmentParameter", "User". */
  entity: z.string().trim().max(64).optional(),
  actorId: idSchema.optional(),
  from: z.date().optional(),
  to: z.date().optional(),
});

export type AuditListInput = z.infer<typeof auditListInputSchema>;

// --- Outputs ----------------------------------------------------------------

/**
 * The one moment the generated password exists in readable form.
 *
 * It is not stored anywhere, not written to the audit payload, and not
 * recoverable: a second reset is the only way to get another one.
 */
export interface ProvisionedCredentials {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
}

export interface UserItem {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly siteId: string | null;
  readonly siteCode: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

export interface SiteOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * One entry of the audit log.
 *
 * `before` and `after` are rendered as label/value pairs rather than raw JSON:
 * the point of the log is that somebody can read what changed months later, and
 * a JSON blob on screen is a log nobody consults.
 */
export interface AuditChange {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface AuditEntryItem {
  readonly id: string;
  readonly entity: string;
  readonly entityId: string;
  readonly action: string;
  readonly actorName: string | null;
  readonly occurredAt: Date;
  readonly changes: readonly AuditChange[];
}
