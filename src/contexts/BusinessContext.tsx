import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";

type BusinessRow = Tables<"businesses">;
type BusinessMemberRow = Tables<"business_members">;

export type BusinessSummary = Pick<
  BusinessRow,
  "id" | "name" | "business_type" | "base_currency" | "country" | "timezone" | "status"
>;

export interface BusinessMembership {
  business_id: string;
  role: BusinessMemberRow["role"];
  business: BusinessSummary;
}

interface BusinessContextValue {
  memberships: BusinessMembership[];
  hasAnyMembership: boolean;
  activeBusiness: BusinessSummary | null;
  activeMembership: BusinessMembership | null;
  isLoading: boolean;
  isSwitching: boolean;
  switchError: string | null;
  error: Error | null;
  switchBusiness: (businessId: string) => Promise<void>;
  refreshMemberships: () => Promise<void>;
}

const BusinessContext = createContext<BusinessContextValue | undefined>(undefined);

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const membershipsQuery = useQuery({
    queryKey: ["business-memberships", user?.id],
    enabled: !!user && !authLoading,
    staleTime: 30_000,
    queryFn: async (): Promise<{ memberships: BusinessMembership[]; hasAnyMembership: boolean }> => {
      if (!user) return { memberships: [], hasAnyMembership: false };

      const { data: membershipRows, error: membershipError } = await supabase
        .from("business_members")
        .select("business_id, role, status")
        .eq("user_id", user.id);

      if (membershipError) throw membershipError;
      const allRows = membershipRows ?? [];
      const rows = allRows.filter((row) => row.status === "active");
      if (!rows.length) return { memberships: [], hasAnyMembership: allRows.length > 0 };

      const businessIds = [...new Set(rows.map((row) => row.business_id))];
      const { data: businessRows, error: businessError } = await supabase
        .from("businesses")
        .select("id, name, business_type, base_currency, country, timezone, status")
        .in("id", businessIds)
        .eq("status", "active");

      if (businessError) throw businessError;
      const businesses = new Map((businessRows ?? []).map((business) => [business.id, business]));

      return {
        memberships: rows.flatMap((membership) => {
          const business = businesses.get(membership.business_id);
          return business
            ? [{ business_id: membership.business_id, role: membership.role, business }]
            : [];
        }),
        hasAnyMembership: allRows.length > 0,
      };
    },
  });

  const memberships = membershipsQuery.data?.memberships ?? [];
  const hasAnyMembership = membershipsQuery.data?.hasAnyMembership ?? false;
  // Metadata is only a navigation hint; the server-side acceptance RPC verifies
  // the signed-in email and invitation ownership before granting membership.
  const pendingInvitationId = String(
    user?.app_metadata?.pending_business_invitation_id ??
    user?.user_metadata?.business_invitation_id ??
    "",
  );
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || membershipsQuery.isLoading || membershipsQuery.error || !user || !pendingInvitationId || memberships.length > 0 || location.pathname === "/accept-invitation") return;
    navigate(`/accept-invitation?invitation_id=${encodeURIComponent(pendingInvitationId)}`, { replace: true });
  }, [authLoading, membershipsQuery.isLoading, membershipsQuery.error, user?.id, pendingInvitationId, memberships.length, location.pathname, navigate]);

  const claimedBusinessId = user?.app_metadata?.active_business_id;
  const activeMembership =
    memberships.find((membership) => membership.business_id === claimedBusinessId) ??
    (memberships.length === 1 ? memberships[0] : null);
  const activeBusiness = activeMembership?.business ?? null;

  const switchBusiness = useCallback(async (businessId: string) => {
    const target = memberships.find((membership) => membership.business_id === businessId);
    if (!target) {
      throw new Error("You are not an active member of that business.");
    }

    setIsSwitching(true);
    setSwitchError(null);
    let serverClaimChanged = false;
    try {
      const { error } = await supabase.functions.invoke("set-active-business", {
        body: { businessId },
      });
      if (error) throw error;
      serverClaimChanged = true;

      // Refresh the JWT before allowing any cached business query to run again.
      // If refresh fails after the server changed the claim, keep the app blocked:
      // resuming with the old token could expose data from the previous workspace.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      await queryClient.cancelQueries();
      queryClient.clear();
      await queryClient.invalidateQueries({ queryKey: ["business-memberships", user?.id] });
      setIsSwitching(false);
    } catch (error) {
      if (serverClaimChanged) {
        setSwitchError("Your business claim changed, but the secure session could not be refreshed. Sign out and sign in again before continuing.");
      } else {
        setIsSwitching(false);
      }
      throw error;
    }
  }, [memberships, queryClient, user?.id]);

  const refreshMemberships = useCallback(async () => {
    await membershipsQuery.refetch();
  }, [membershipsQuery]);

  const value = useMemo<BusinessContextValue>(() => ({
    memberships,
    hasAnyMembership,
    activeBusiness,
    activeMembership,
    isLoading: authLoading || membershipsQuery.isLoading,
    isSwitching,
    switchError,
    error: membershipsQuery.error instanceof Error ? membershipsQuery.error : null,
    switchBusiness,
    refreshMemberships,
  }), [
    memberships,
    hasAnyMembership,
    activeBusiness,
    activeMembership,
    authLoading,
    isSwitching,
    switchError,
    membershipsQuery.isLoading,
    membershipsQuery.error,
    switchBusiness,
    refreshMemberships,
  ]);

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (!context) {
    throw new Error("useBusiness must be used within a BusinessProvider");
  }
  return context;
}
