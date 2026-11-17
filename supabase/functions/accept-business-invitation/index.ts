import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    console.error("Invitation acceptance environment is incomplete");
    return respond({ error: "Invitation acceptance is temporarily unavailable" }, 500);
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
    if (!authData.user.email_confirmed_at) {
      return respond({ error: "Confirm the invited email address before accepting the business invitation" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const invitationId = typeof body?.invitationId === "string"
      ? body.invitationId
      : String(
        authData.user.app_metadata?.pending_business_invitation_id ??
        authData.user.user_metadata?.business_invitation_id ??
        "",
      );

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId)) {
      return respond({ error: "No valid pending business invitation was found" }, 400);
    }

    const { data: businessId, error: acceptError } = await userClient.rpc("accept_business_invitation", {
      p_invitation_id: invitationId,
    });
    if (acceptError || typeof businessId !== "string") {
      return respond({ error: acceptError?.message ?? "The invitation could not be accepted" }, 403);
    }

    const { data: adminUser, error: adminLookupError } = await adminClient.auth.admin.getUserById(authData.user.id);
    if (adminLookupError || !adminUser.user) {
      console.error("Invitation accepted but active workspace metadata could not be loaded", adminLookupError);
      return respond({ success: true, business_id: businessId, active_business_set: false });
    }

    const appMetadata = { ...(adminUser.user.app_metadata ?? {}), active_business_id: businessId };
    delete appMetadata.pending_business_invitation_id;

    const userMetadata = { ...(adminUser.user.user_metadata ?? {}) };
    delete userMetadata.business_invitation_id;

    const { error: updateError } = await adminClient.auth.admin.updateUserById(authData.user.id, {
      app_metadata: appMetadata,
      user_metadata: userMetadata,
    });
    if (updateError) {
      console.error("Invitation accepted but active workspace metadata could not be updated", updateError);
      return respond({ success: true, business_id: businessId, active_business_set: false });
    }

    return respond({ success: true, business_id: businessId, active_business_set: true });
  } catch (error) {
    console.error("Business invitation acceptance failed", error);
    return respond({ error: "Unable to accept the business invitation" }, 500);
  }
});
