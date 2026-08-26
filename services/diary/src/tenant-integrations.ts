import type { SupabaseClient } from "@supabase/supabase-js";

// Twin of src/lib/tenant-integrations.ts — same tenant_id-scoped lookup (see
// that file's header comment for why the naive `.maybeSingle()` shortcut
// breaks for platform admins). Only the one flag this service actually
// checks (cause_list_enabled), not the full Integrations shape.
export async function getCauseListEnabled(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.tenant_id) return true;

  const { data: license } = await supabase
    .from("licenses")
    .select("integrations")
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();
  const integrations = (license?.integrations ?? {}) as Record<string, boolean | undefined>;
  return integrations.cause_list_enabled ?? true;
}
