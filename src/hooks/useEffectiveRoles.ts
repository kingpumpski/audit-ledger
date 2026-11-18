import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { getEffectiveRoles } from "@/lib/business-roles";

export function useEffectiveRoles() {
  const { roles: globalRoles } = useAuth();
  const { activeMembership } = useBusiness();

  return getEffectiveRoles(globalRoles, activeMembership?.role);
}
