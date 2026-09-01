import { buildCredentialAccount, generatePassword } from "@leoni/auth/credentials";
import type {
  AuditEntryItem,
  AuditListInput,
  CreateUserInput,
  Page,
  ProvisionedCredentials,
  ResetPasswordInput,
  SiteOption,
  UpdateUserInput,
  UserItem,
  UserListInput,
} from "@leoni/contracts";
import { BusinessRuleError, isCrossSiteRole, NotFoundError } from "@leoni/core";

import type { Actor } from "../../context";
import type { AuditPayload } from "../../shared/audit";
import * as mapper from "./admin.mapper";
import type { AdminRepository, UpdateUserData } from "./admin.repository";
import { adminRepository } from "./admin.repository";

/**
 * Business rules for user administration.
 *
 * Two rules live here and both exist because the alternative is a lockout: an
 * administrator cannot demote or deactivate their own account, and a
 * single-site role must be given a plant. Neither is enforceable by a schema —
 * the first needs to know who is asking, and the second is a statement about
 * how LEONI is organised.
 */

interface ServiceParams<TInput> {
  readonly actor: Actor;
  readonly input: TInput;
  /** Injected by the tests. Defaults to the Prisma-backed repository. */
  readonly repository?: AdminRepository;
}

export async function listUsers({
  input,
  repository = adminRepository,
}: ServiceParams<UserListInput>): Promise<readonly UserItem[]> {
  const [rows, sites] = await Promise.all([repository.findUsers(input), repository.findSites()]);
  const siteCodeById = new Map(sites.map((site) => [site.id, site.code]));

  return rows.map((row) => mapper.toUserItem(row, siteCodeById));
}

export async function listSites({
  repository = adminRepository,
}: {
  readonly actor: Actor;
  readonly repository?: AdminRepository;
}): Promise<readonly SiteOption[]> {
  const sites = await repository.findSites();
  return sites.map(mapper.toSiteOption);
}

function auditPayload(data: UpdateUserData): AuditPayload {
  return { role: data.role, siteId: data.siteId, isActive: data.isActive };
}

/**
 * A single-site role with no plant sees nothing.
 *
 * `resolveSiteFilter` fails closed on it, so the account would be created
 * broken rather than restricted — and the symptom is "every screen is empty",
 * which nobody diagnoses as a missing site.
 */
function resolveSiteForRole(role: UpdateUserData["role"], siteId: string | null): string | null {
  if (isCrossSiteRole(role)) {
    // The two cross-site roles span both plants; storing one would be a lie
    // the scoping middleware then has to ignore.
    return null;
  }

  if (siteId === null) {
    throw new BusinessRuleError("Un role rattache a un site doit se voir attribuer un site.", {
      role,
    });
  }

  return siteId;
}

/**
 * Provisions an account.
 *
 * The password is generated here and returned once. It is never stored in the
 * audit payload: an audit log that contains credentials is a credential store
 * with a friendly name, and this one is readable by the Logistics Manager.
 *
 * Sign-up stays disabled in `@leoni/auth`. This is the sanctioned way an
 * account comes into existence, which is what the brief asks for (section 4).
 */
export async function createUser({
  actor,
  input,
  repository = adminRepository,
}: ServiceParams<CreateUserInput>): Promise<ProvisionedCredentials> {
  const existing = await repository.findUserByEmail(input.email);

  if (existing !== null) {
    throw new BusinessRuleError(`Un compte existe deja pour ${input.email}.`, {
      email: input.email,
    });
  }

  const siteId = resolveSiteForRole(input.role, input.siteId);
  const userId = crypto.randomUUID();
  const password = generatePassword();

  await repository.createUserWithAudit({
    userId,
    data: { name: input.name, email: input.email, role: input.role, siteId },
    account: await buildCredentialAccount(userId, password),
    audit: {
      entity: "User",
      entityId: userId,
      action: "CREATE",
      before: null,
      // Deliberately no password, not even a hash.
      after: { name: input.name, email: input.email, role: input.role, siteId },
      actorId: actor.userId,
    },
  });

  return { userId, email: input.email, password };
}

/**
 * Issues a new password and signs the account out everywhere.
 *
 * Ending the sessions is the part that matters: a reset that leaves them alive
 * locks nobody out, which is the one thing a reset is for.
 */
export async function resetPassword({
  actor,
  input,
  repository = adminRepository,
}: ServiceParams<ResetPasswordInput>): Promise<ProvisionedCredentials> {
  const existing = await repository.findUserById(input.userId);

  if (existing === null) {
    throw new NotFoundError(`Utilisateur introuvable : ${input.userId}`, {
      userId: input.userId,
    });
  }

  const password = generatePassword();

  await repository.resetPasswordWithAudit({
    userId: input.userId,
    account: await buildCredentialAccount(input.userId, password),
    audit: {
      entity: "User",
      entityId: input.userId,
      action: "RESET_PASSWORD",
      before: null,
      after: { email: existing.email },
      actorId: actor.userId,
    },
  });

  return { userId: input.userId, email: existing.email, password };
}

/**
 * Changes a person's role, plant and access.
 *
 * The self-lockout guard is not paranoia: there is one Administrator account in
 * a running installation, and an accidental demotion leaves nobody able to undo
 * it without a database console. Refusing here is cheaper than that evening.
 */
export async function updateUser({
  actor,
  input,
  repository = adminRepository,
}: ServiceParams<UpdateUserInput>): Promise<{ userId: string }> {
  const existing = await repository.findUserById(input.userId);

  if (existing === null) {
    throw new NotFoundError(`Utilisateur introuvable : ${input.userId}`, {
      userId: input.userId,
    });
  }

  if (input.userId === actor.userId && (!input.isActive || input.role !== actor.role)) {
    throw new BusinessRuleError(
      "Vous ne pouvez pas modifier votre propre role ni desactiver votre compte.",
      { userId: input.userId },
    );
  }

  // A single-site role with no plant sees nothing: `resolveSiteFilter` fails
  // closed on it, so the account would be left broken rather than restricted.
  if (!isCrossSiteRole(input.role) && input.siteId === null) {
    throw new BusinessRuleError("Un role rattache a un site doit se voir attribuer un site.", {
      role: input.role,
    });
  }

  // The two cross-site roles span both plants; storing one would be a lie the
  // scoping middleware then has to ignore.
  const data: UpdateUserData = {
    role: input.role,
    siteId: isCrossSiteRole(input.role) ? null : input.siteId,
    isActive: input.isActive,
  };

  await repository.updateUserWithAudit({
    userId: input.userId,
    data,
    audit: {
      entity: "User",
      entityId: input.userId,
      action: "UPDATE",
      before: auditPayload({
        role: existing.role,
        siteId: existing.siteId,
        isActive: existing.isActive,
      }),
      after: auditPayload(data),
      actorId: actor.userId,
    },
  });

  return { userId: input.userId };
}

export async function listAudit({
  input,
  repository = adminRepository,
}: ServiceParams<AuditListInput>): Promise<Page<AuditEntryItem>> {
  const { rows, totalCount } = await repository.findAuditEntries(input);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  return {
    items: page.map(mapper.toAuditEntryItem),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    totalCount,
  };
}

export async function listAuditedEntities({
  repository = adminRepository,
}: {
  readonly actor: Actor;
  readonly repository?: AdminRepository;
}): Promise<readonly string[]> {
  return repository.findAuditedEntities();
}
