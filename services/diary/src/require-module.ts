import type { SupabaseClient } from "@supabase/supabase-js";

// Twin of supabase/functions/_shared/modules.ts and src/lib/require-module.ts
// — same "{module}_enabled" convention in licenses.integrations, same trial
// bypass. Diary and Cause List are one sellable module ("diary") per the
// microservices plan — reconcileHearing's tight coupling between the two
// made splitting them not worth it (see bright-toasting-thompson.md).
export async function requireDiaryModule(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.tenant_id) throw new Error("No chamber found for this account.");

  const { data: license } = await supabase
    .from("licenses")
    .select("plan, integrations")
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();
  if (!license) throw new Error("No license found for this chamber.");
  if (license.plan === "trial") return;

  const integrations = (license.integrations ?? {}) as Record<string, boolean | undefined>;
  if (integrations["diary_enabled"] === true) return;

  throw new Error(
    "The court diary isn't included on this chamber's plan yet — contact chambers@lexdiary.online to add it.",
  );
}
