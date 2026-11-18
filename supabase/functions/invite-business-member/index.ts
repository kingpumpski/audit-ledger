import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedRoles = new Set(["owner", "admin", "accountant", "cashier", "auditor"]);

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function findAuthUserByEmail(adminClient: SupabaseClient, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  throw new Error("User directory pagination limit reached");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return respond({ error: "Authentication is required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Invitation function environment is incomplete");
    return respond({ error: "Invitations are temporarily unavailable" }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return respond({ error: "Your session is invalid or expired" }, 401);

    const body = await req.json().catch(() => null);
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = typeof body?.role === "string" ? body.role.trim().toLowerCase() : "";

    if (!uuidPattern.test(businessId)) return respond({ error: "A valid business is required" }, 400);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return respond({ error: "Enter a valid email address" }, 400);
    }
    if (!allowedRoles.has(role)) return respond({ error: "Select a valid business role" }, 400);

    const { data: actorMembership, error: actorError } = await userClient
      .from("business_members")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (actorError || !actorMembership || !["owner", "admin"].includes(actorMembership.role)) {
      return respond({ error: "Only an active business owner or administrator can invite members" }, 403);
    }
    if (actorMembership.role === "admin" && ["owner", "admin"].includes(role)) {
      return respond({ error: "Administrators cannot invite owners or administrators" }, 403);
    }

    const { data: business, error: businessError } = await userClient
      .from("businesses")
      .select("id, name, status")
      .eq("id", businessId)
      .maybeSingle();
    if (businessError || !business || business.status !== "active") {
      return respond({ error: "The selected business is unavailable" }, 404);
    }

    const existingUser = await findAuthUserByEmail(adminClient, email);
    if (existingUser?.email_confirmed_at || existingUser?.confirmed_at) {
      const { data: existingMembership, error: existingMembershipError } = await userClient
        .from("business_members")
        .select("id, status")
        .eq("business_id", businessId)
        .eq("user_id", existingUser.id)
        .maybeSingle();
      if (existingMembershipError) throw existingMembershipError;
      if (existingMembership?.status === "active") {
        return respond({ error: "This person is already an active member" }, 409);
      }

      const { data: memberId, error: memberError } = await userClient.rpc("set_business_member_access", {
        p_business_id: businessId,
        p_user_id: existingUser.id,
        p_role: role,
        p_status: "active",
      });
      if (memberError) return respond({ error: memberError.message }, 403);
      return respond({ status: "added_existing_user", member_id: memberId });
    }

    const { data: pending, error: pendingError } = await adminClient
      .from("business_invitations")
      .select("id")
      .eq("business_id", businessId)
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();
    if (pendingError) throw pendingError;
    if (pending) return respond({ error: "An invitation is already pending for this email" }, 409);

    const { data: invitation, error: invitationError } = await adminClient
      .from("business_invitations")
      .insert({
        business_id: businessId,
        email,
        role,
        invited_by: authData.user.id,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (invitationError) throw invitationError;

    const appUrl = (Deno.env.get("APP_URL") || "https://kingpumpski.github.io/audit-ledger").replace(/\/$/, "");
    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: {
        business_invitation_id: invitation.id,
        business_name: business.name,
      },
      redirectTo: `${appUrl}/accept-invitation?invitation_id=${encodeURIComponent(invitation.id)}`,
    });

    if (inviteError || !invited.user) {
      await adminClient.from("business_invitations")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", invitation.id);
      console.error("Supabase Auth invitation failed", inviteError);
      return respond({ error: "The invitation email could not be sent. Check the Auth email configuration and try again." }, 502);
    }

    const appMetadata = invited.user.app_metadata ?? {};
    const { error: metadataError } = await adminClient.auth.admin.updateUserById(invited.user.id, {
      app_metadata: { ...appMetadata, pending_business_invitation_id: invitation.id },
    });
    if (metadataError) {
      console.error("Unable to attach pending invitation metadata", metadataError);
      // The invitation metadata is also present in user_metadata, and the
      // acceptance RPC independently verifies the signed-in email address.
    }

    const { error: updateError } = await adminClient
      .from("business_invitations")
      .update({
        auth_user_id: invited.user.id,
        last_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitation.id);
    if (updateError) throw updateError;

    const { error: auditError } = await adminClient.from("audit_logs").insert({
      user_id: authData.user.id,
      user_email: authData.user.email,
      action: "create",
      entity_type: "business_invitation",
      entity_id: invitation.id,
      old_data: null,
      new_data: { email, role, status: "pending" },
      metadata: { business_id: businessId },
      business_id: businessId,
    });
    if (auditError) {
      console.error("Invitation sent but audit event could not be recorded", auditError);
      return respond({ error: "The invitation was sent but its audit record could not be saved" }, 500);
    }

    return respond({ status: "invited", invitation_id: invitation.id });
  } catch (error) {
    console.error("Business invitation failed", error);
    return respond({ error: "Unable to complete the invitation" }, 500);
  }
});
