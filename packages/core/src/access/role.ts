/**
 * The five actors of the process (brief section 4).
 *
 * The role names stay in English like every other identifier in the codebase;
 * their French labels are a presentation concern and live in @leoni/contracts.
 */
export const ROLES = [
  "ADMIN",
  "LTN1_STOREKEEPER",
  "LTN1_WAREHOUSE_MANAGER",
  "LTN4_RESPONSIBLE",
  "LOGISTICS_MANAGER",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return ROLES.some((role) => role === value);
}

/**
 * Roles that see both plants.
 *
 * Stated assumption (section 4): a user belongs to exactly one site, except the
 * Administrator and the Logistics Manager, whose whole job is the consolidated
 * view. Every query in the application is scoped by this rule.
 */
export const CROSS_SITE_ROLES: readonly Role[] = ["ADMIN", "LOGISTICS_MANAGER"];

export function isCrossSiteRole(role: Role): boolean {
  return CROSS_SITE_ROLES.includes(role);
}
