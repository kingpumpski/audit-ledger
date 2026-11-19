import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { getEffectiveRoles } from "@/lib/business-roles";

export function useEffectiveRoles() {
  const { roles: globalRoles } = useAuth();
  const { activeMembership, memberships, hasAnyMembership, isLoading, error } = useBusiness();

  if (isLoading || error || (memberships.length > 1 && !activeMembership)) return [];
  // A suspended/pending membership is not a legacy account. Do not fall back
  // to global roles when any workspace membership record exists but none is active.
  if (hasAnyMembership && !activeMembership) return [];
  return getEffectiveRoles(globalRoles, activeMembership?.role);
}
