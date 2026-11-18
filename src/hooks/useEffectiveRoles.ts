import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { getEffectiveRoles } from "@/lib/business-roles";

export function useEffectiveRoles() {
  const { roles: globalRoles } = useAuth();
  const { activeMembership, memberships, isLoading, error } = useBusiness();

  if (isLoading || error || (memberships.length > 1 && !activeMembership)) return [];
  return getEffectiveRoles(globalRoles, activeMembership?.role);
}
