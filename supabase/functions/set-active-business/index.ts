import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication is required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Supabase function environment is incomplete");
    return jsonResponse({ error: "Workspace switching is temporarily unavailable" }, 500);
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
    if (authError || !authData.user) {
      return jsonResponse({ error: "Your session is invalid or has expired" }, 401);
    }

    const body = await req.json().catch(() => null);
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
      return jsonResponse({ error: "A valid business ID is required" }, 400);
    }

    const { data: isMember, error: membershipError } = await userClient.rpc("is_business_member", {
      p_business_id: businessId,
    });
    if (membershipError || isMember !== true) {
      return jsonResponse({ error: "You are not an active member of this business" }, 403);
    }

    const { data: business, error: businessError } = await userClient
      .from("businesses")
      .select("id, status")
      .eq("id", businessId)
      .maybeSingle();
    if (businessError || !business || business.status !== "active") {
      return jsonResponse({ error: "This business is unavailable" }, 403);
    }

    const { data: adminUser, error: adminLookupError } = await adminClient.auth.admin.getUserById(authData.user.id);
    if (adminLookupError || !adminUser.user) {
      console.error("Unable to load user metadata for workspace switch", adminLookupError);
      return jsonResponse({ error: "Unable to update your workspace session" }, 500);
    }

    const appMetadata = adminUser.user.app_metadata ?? {};
    const { error: updateError } = await adminClient.auth.admin.updateUserById(authData.user.id, {
      app_metadata: { ...appMetadata, active_business_id: businessId },
    });
    if (updateError) {
      console.error("Unable to update active business claim", updateError);
      return jsonResponse({ error: "Unable to update your workspace session" }, 500);
    }

    return jsonResponse({ success: true, active_business_id: businessId });
  } catch (error) {
    console.error("Active business update failed", error);
    return jsonResponse({ error: "Unable to update your workspace session" }, 500);
  }
});
