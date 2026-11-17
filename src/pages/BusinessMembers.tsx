import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, MailPlus, RefreshCw, ShieldCheck, UserRound, UserX } from "lucide-react";

type MemberRole = "owner" | "admin" | "accountant" | "cashier" | "auditor";
type MemberStatus = "active" | "suspended";

const roleLabels: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Administrator",
  accountant: "Accountant",
  cashier: "Cashier",
  auditor: "Auditor",
};

const roleOptions: MemberRole[] = ["admin", "accountant", "cashier", "auditor"];

export default function BusinessMembersPage() {
  const { activeBusiness, activeMembership, isLoading: businessLoading } = useBusiness();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("accountant");
  const [isInviting, setIsInviting] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);

  const isOwner = activeMembership?.role === "owner";
  const isManager = isOwner || activeMembership?.role === "admin";

  const membersQuery = useQuery({
    queryKey: ["business-members", activeBusiness?.id],
    enabled: !!activeBusiness?.id && !!isManager,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_business_members", {
        p_business_id: activeBusiness!.id,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invitationsQuery = useQuery({
    queryKey: ["business-invitations", activeBusiness?.id],
    enabled: !!activeBusiness?.id && !!isManager,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_invitations")
        .select("id, email, role, status, expires_at, created_at")
        .eq("business_id", activeBusiness!.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const refreshLists = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["business-members", activeBusiness?.id] }),
      queryClient.invalidateQueries({ queryKey: ["business-invitations", activeBusiness?.id] }),
    ]);
  };

  const inviteMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeBusiness) return;
    setIsInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-business-member", {
        body: { businessId: activeBusiness.id, email: email.trim(), role },
      });
      if (error) throw error;

      if (data?.status === "added_existing_user") {
        toast.success("Existing account added to this business");
      } else {
        toast.success("Invitation email sent");
      }
      setEmail("");
      await refreshLists();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to invite this person");
    } finally {
      setIsInviting(false);
    }
  };

  const updateMember = async (member: {
    member_id: string;
    user_id: string;
    role: string;
    status: string;
  }, nextRole: MemberRole, nextStatus: MemberStatus) => {
    if (!activeBusiness) return;
    setBusyMemberId(member.member_id);
    try {
      const { error } = await supabase.rpc("set_business_member_access", {
        p_business_id: activeBusiness.id,
        p_user_id: member.user_id,
        p_role: nextRole,
        p_status: nextStatus,
      });
      if (error) throw error;
      toast.success("Business access updated");
      await refreshLists();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update business access");
    } finally {
      setBusyMemberId(null);
    }
  };

  const revokeInvitation = async (invitationId: string) => {
    setBusyInvitationId(invitationId);
    try {
      const { data, error } = await supabase.rpc("revoke_business_invitation", {
        p_invitation_id: invitationId,
      });
      if (error) throw error;
      if (data) toast.success("Invitation revoked");
      await refreshLists();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to revoke invitation");
    } finally {
      setBusyInvitationId(null);
    }
  };

  if (businessLoading) {
    return <AppLayout title="Business Members"><div className="p-8 text-sm text-muted-foreground">Loading business access...</div></AppLayout>;
  }

  if (!activeBusiness) {
    return <AppLayout title="Business Members"><div className="rounded-xl border p-6 text-sm text-muted-foreground">Your account is not an active member of a business workspace.</div></AppLayout>;
  }

  if (!isManager) {
    return <AppLayout title="Business Members"><div className="rounded-xl border p-6 text-sm text-muted-foreground">Only business owners and administrators can manage members and invitations.</div></AppLayout>;
  }

  return (
    <AppLayout title="Business Members" subtitle={activeBusiness.name}>
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <MailPlus className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold">Invite a team member</h2>
              <p className="text-sm text-muted-foreground">Invite a new user by email or add an existing account to this business.</p>
            </div>
          </div>
          <form onSubmit={inviteMember} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_13rem_auto]">
            <Input
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              aria-label="Team member email"
            />
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value as MemberRole)}
              aria-label="Business role"
            >
              {roleOptions.filter((option) => isOwner || option !== "admin").map((option) => (
                <option key={option} value={option}>{roleLabels[option]}</option>
              ))}
            </select>
            <Button type="submit" disabled={isInviting}>
              {isInviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}
              {isInviting ? "Sending..." : "Invite"}
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            {isOwner ? "Owners can grant any business role." : "Administrators can invite accountants, cashiers and auditors. Owner and administrator access is reserved for owners."}
          </p>
        </section>

        <section className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b p-5">
            <div className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-primary" />
              <div>
                <h2 className="font-semibold">Current members</h2>
                <p className="text-sm text-muted-foreground">Manage the roles and access status of this business's members.</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshLists()}>
              <RefreshCw className="mr-2 h-4 w-4" />Refresh
            </Button>
          </div>
          {membersQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading members...</div>
          ) : membersQuery.error ? (
            <div className="p-6 text-sm text-destructive">Unable to load members: {membersQuery.error.message}</div>
          ) : (
            <div className="divide-y">
              {(membersQuery.data ?? []).map((member) => {
                const isSelf = member.user_id === activeMembership?.business_id; // replaced below using actor identity
                const protectedMember = !isOwner && ["owner", "admin"].includes(member.role);
                const isBusy = busyMemberId === member.member_id;
                return (
                  <div key={member.member_id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_12rem_10rem] md:items-center">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{member.full_name || member.email}</div>
                      <div className="truncate text-sm text-muted-foreground">{member.email}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{member.role === "owner" ? "Business owner" : "Member"} · Joined {member.joined_at ? new Date(member.joined_at).toLocaleDateString() : "—"}</div>
                    </div>
                    <select
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={member.role as MemberRole}
                      disabled={isBusy || isSelf || protectedMember}
                      onChange={(event) => void updateMember(member, event.target.value as MemberRole, member.status as MemberStatus)}
                      aria-label={`Role for ${member.email}`}
                    >
                      {(isOwner ? ["owner", ...roleOptions] : roleOptions.filter((option) => option !== "admin")).map((option) => (
                        <option key={option} value={option}>{roleLabels[option]}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs ${member.status === "active" ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                        {member.status}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBusy || isSelf || protectedMember}
                        onClick={() => void updateMember(member, member.role as MemberRole, member.status === "active" ? "suspended" : "active")}
                        aria-label={member.status === "active" ? "Suspend member" : "Reactivate member"}
                      >
                        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {!membersQuery.data?.length && <div className="p-6 text-sm text-muted-foreground">No members were found for this business.</div>}
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b p-5">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold">Pending invitations</h2>
              <p className="text-sm text-muted-foreground">Invitations expire after one hour unless accepted.</p>
            </div>
          </div>
          {invitationsQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading invitations...</div>
          ) : invitationsQuery.error ? (
            <div className="p-6 text-sm text-destructive">Unable to load invitations: {invitationsQuery.error.message}</div>
          ) : (
            <div className="divide-y">
              {(invitationsQuery.data ?? []).map((invitation) => (
                <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{invitation.email}</div>
                    <div className="text-sm text-muted-foreground">{roleLabels[invitation.role as MemberRole]} · Expires {new Date(invitation.expires_at).toLocaleString()}</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyInvitationId === invitation.id}
                    onClick={() => void revokeInvitation(invitation.id)}
                  >
                    {busyInvitationId === invitation.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Revoke
                  </Button>
                </div>
              ))}
              {!invitationsQuery.data?.length && <div className="p-6 text-sm text-muted-foreground">No pending invitations.</div>}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
