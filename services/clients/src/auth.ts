import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Twin of supabase/functions/_shared/auth.ts, adapted from Deno.env to
// process.env (nodejs_compat shims this from wrangler.toml's [vars], same as
// the main app's own server code). No SUPABASE_SERVICE_ROLE_KEY here or
// anywhere in this service, ever — every query runs scoped to the calling
// user's own JWT and is subject to the same RLS policies as the main app.
export function authedClient(req: Request): { supabase: SupabaseClient; token: string } | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  if (!token || token.split(".").length !== 3) return null;

  const supabase = createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"]!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    },
  );

  return { supabase, token };
}

// getClaims(token) verifies the JWT locally against cached JWKS — same
// verification path as the main app's requireSupabaseAuth middleware, and
// unlike getUser() (no argument), doesn't require a live round-trip to
// Supabase's Auth server on every single request.
export async function requireUserId(
  supabase: SupabaseClient,
  token: string,
): Promise<string | null> {
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
}
