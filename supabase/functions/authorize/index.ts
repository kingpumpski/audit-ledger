import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuthorizeRequest {
  requiredRoles?: string[];
  requiredPermission?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ authorized: false, error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the JWT token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ authorized: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { requiredRoles, requiredPermission }: AuthorizeRequest = await req.json();

    // Get user's roles
    const { data: userRoles, error: rolesError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    if (rolesError) {
      return new Response(
        JSON.stringify({ authorized: false, error: "Failed to fetch roles" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const roles = userRoles?.map(r => r.role) || [];

    // Check if user has any role
    if (roles.length === 0) {
      return new Response(
        JSON.stringify({ 
          authorized: false, 
          error: "No roles assigned",
          user: { id: user.id, email: user.email },
          roles: []
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check required roles
    if (requiredRoles && requiredRoles.length > 0) {
      const hasRequiredRole = requiredRoles.some(role => roles.includes(role));
      if (!hasRequiredRole) {
        return new Response(
          JSON.stringify({ 
            authorized: false, 
            error: "Insufficient role privileges",
            user: { id: user.id, email: user.email },
            roles,
            requiredRoles
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Check required permission
    if (requiredPermission) {
      const { data: hasPermission, error: permissionError } = await supabase
        .rpc("has_permission", {
          permission_code: requiredPermission,
          target_user_id: user.id,
        });

      if (permissionError) {
        console.error("Failed to verify permission:", permissionError.message);
        return new Response(
          JSON.stringify({ authorized: false, error: "Failed to verify permission" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!hasPermission) {
        return new Response(
          JSON.stringify({ 
            authorized: false, 
            error: "Insufficient permissions",
            user: { id: user.id, email: user.email },
            roles,
            requiredPermission
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ 
        authorized: true, 
        user: { id: user.id, email: user.email },
        roles
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Authorization error:", error);
    return new Response(
      JSON.stringify({ authorized: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
