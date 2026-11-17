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

  return [...new Set([...validGlobalRoles, ...membershipRoles])];
}
