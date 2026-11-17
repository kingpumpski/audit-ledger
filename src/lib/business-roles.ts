export type AppRole = "admin" | "accountant" | "cashier" | "auditor";

const BUSINESS_ROLE_MAP: Record<string, AppRole[]> = {
  owner: ["admin", "accountant", "cashier", "auditor"],
  admin: ["admin"],
  accountant: ["accountant"],
  cashier: ["cashier"],
  auditor: ["auditor"],
};

export function getEffectiveRoles(
  globalRoles: readonly string[],
  businessRole?: string | null,
): AppRole[] {
  const validGlobalRoles = globalRoles.filter(
    (role): role is AppRole =>
      role === "admin" ||
      role === "accountant" ||
      role === "cashier" ||
      role === "auditor",
  );
  const membershipRoles = businessRole
    ? BUSINESS_ROLE_MAP[businessRole] ?? []
    : [];

  // Once a user has an active business membership, that membership is the
  // authoritative permission source. Global roles are a legacy fallback only
  // for users who have not yet been migrated into a workspace.
  return businessRole
    ? [...new Set(membershipRoles)]
    : [...new Set(validGlobalRoles)];
}
