import type { SupabaseClient } from "@supabase/supabase-js";

// Twin of supabase/functions/_shared/modules.ts and src/lib/require-module.ts
// — same "{module}_enabled" convention in licenses.integrations, same trial
// bypass. Documents absorbed OCR as one sellable module ("documents") per
// the microservices plan.
export async function requireDocumentsModule(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
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
  if (integrations["documents_enabled"] === true) return;

  throw new Error(
    "Document intake isn't included on this chamber's plan yet — contact chambers@lexdiary.online to add it.",
  );
}
