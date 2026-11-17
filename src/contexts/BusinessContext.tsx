import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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
  activeBusiness: BusinessSummary | null;
  activeMembership: BusinessMembership | null;
  isLoading: boolean;
  error: Error | null;
  switchBusiness: (businessId: string) => Promise<void>;
  refreshMemberships: () => Promise<void>;
}

const BusinessContext = createContext<BusinessContextValue | undefined>(undefined);

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const membershipsQuery = useQuery({
    queryKey: ["business-memberships", user?.id],
    enabled: !!user && !authLoading,
    staleTime: 30_000,
    queryFn: async (): Promise<BusinessMembership[]> => {
      if (!user) return [];

      const { data: membershipRows, error: membershipError } = await supabase
        .from("business_members")
        .select("business_id, role")
        .eq("user_id", user.id)
        .eq("status", "active");

      if (membershipError) throw membershipError;
      const rows = membershipRows ?? [];
      if (!rows.length) return [];

      const businessIds = [...new Set(rows.map((row) => row.business_id))];
      const { data: businessRows, error: businessError } = await supabase
        .from("businesses")
        .select("id, name, business_type, base_currency, country, timezone, status")
        .in("id", businessIds)
        .eq("status", "active");

      if (businessError) throw businessError;
      const businesses = new Map((businessRows ?? []).map((business) => [business.id, business]));

      return rows.flatMap((membership) => {
        const business = businesses.get(membership.business_id);
        return business
          ? [{ business_id: membership.business_id, role: membership.role, business }]
          : [];
      });
    },
  });

  const memberships = membershipsQuery.data ?? [];
  const pendingInvitationId = String(
    user?.app_metadata?.pending_business_invitation_id ??
    user?.user_metadata?.business_invitation_id ??
    "",
  );
  const processedInvitationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user || !pendingInvitationId || processedInvitationRef.current === pendingInvitationId) return;
    processedInvitationRef.current = pendingInvitationId;

    void (async () => {
      const { error } = await supabase.functions.invoke("accept-business-invitation", {
        body: { invitationId: pendingInvitationId },
      });
      if (error) {
        toast.error(error.message || "Unable to accept the business invitation");
        return;
      }

      await queryClient.cancelQueries();
      queryClient.clear();
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        toast.error("Invitation accepted. Please refresh to load your business workspace.");
        return;
      }
      await membershipsQuery.refetch();
      toast.success("Business invitation accepted");
    })();
  }, [user?.id, pendingInvitationId, queryClient, membershipsQuery.refetch]);

  const claimedBusinessId = user?.app_metadata?.active_business_id;
  const activeMembership =
    memberships.find((membership) => membership.business_id === claimedBusinessId) ??
    memberships[0] ??
    null;
  const activeBusiness = activeMembership?.business ?? null;

  const switchBusiness = useCallback(async (businessId: string) => {
    const target = memberships.find((membership) => membership.business_id === businessId);
    if (!target) {
      throw new Error("You are not an active member of that business.");
    }

    const { error } = await supabase.functions.invoke("set-active-business", {
      body: { businessId },
    });
    if (error) throw error;

    // Cancel and clear all cached records before accepting the refreshed token.
    // This prevents a previous business's query results from flashing after a switch.
    await queryClient.cancelQueries();
    queryClient.clear();

    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw refreshError;

    await queryClient.invalidateQueries({ queryKey: ["business-memberships", user?.id] });
  }, [memberships, membershipsQuery, queryClient]);

  const refreshMemberships = useCallback(async () => {
    await membershipsQuery.refetch();
  }, [membershipsQuery]);

  const value = useMemo<BusinessContextValue>(() => ({
    memberships,
    activeBusiness,
    activeMembership,
    isLoading: authLoading || membershipsQuery.isLoading,
    error: membershipsQuery.error instanceof Error ? membershipsQuery.error : null,
    switchBusiness,
    refreshMemberships,
  }), [
    memberships,
    activeBusiness,
    activeMembership,
    authLoading,
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
