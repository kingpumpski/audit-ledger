import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Recursively HTML-escape every string in a record so it is safe to interpolate into templates. */
// deno-lint-ignore no-explicit-any
export function escapeDeep<T>(value: T): any {
  if (typeof value === "string") return escapeHtml(value);
  if (Array.isArray(value)) return value.map((v) => escapeDeep(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = escapeDeep(v);
    return out;
  }
  return value;
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

export type AuthResult =
  | { ok: true; userId: string | null; roles: string[]; isService: boolean }
  | { ok: false; status: number; error: string };

/**
 * Validates the caller's JWT and requires one of the given roles.
 * If allowService is true, a request bearing the service role key (e.g. cron / other functions) is accepted.
 */
export async function requireRoles(
  req: Request,
  allowed: string[],
  opts: { allowService?: boolean } = {},
): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return { ok: false, status: 401, error: "Unauthorized" };
  const token = authHeader.slice(7).trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (opts.allowService && serviceKey && token === serviceKey) {
    return { ok: true, userId: null, roles: [], isService: true };
  }
  const admin = serviceClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { ok: false, status: 401, error: "Unauthorized" };
  const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", data.user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.some((r) => allowed.includes(r))) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, userId: data.user.id, roles, isService: false };
}
