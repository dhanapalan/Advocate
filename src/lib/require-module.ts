import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Worker-side twin of supabase/functions/_shared/modules.ts — same logic,
// same "{module}_enabled" convention in licenses.integrations, same trial
// bypass. Didn't exist before this migration: src/lib/*.functions.ts had no
// paid-tier gate at all for matters/clients/diary/documents/billing, only
// RLS (which stops cross-tenant access, but never gated "does this tenant's
// own plan include this feature"). Port fixes to both copies.
export type ModuleKey =
  | "ai_drafting"
  | "ai_assistant"
  | "matter_intelligence"
  | "matters"
  | "clients"
  | "diary"
  | "documents"
  | "billing";

const MODULE_LABELS: Record<ModuleKey, string> = {
  ai_drafting: "AI drafting (including dictation)",
  ai_assistant: "the AI case assistant",
  matter_intelligence: "AI matter intelligence",
  matters: "case/matter tracking",
  clients: "client management",
  diary: "the court diary",
  documents: "document intake (including OCR)",
  billing: "time tracking and billing",
};

export async function requireModule(
  supabase: SupabaseClient<Database>,
  userId: string,
  moduleKey: ModuleKey,
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
  if (integrations[`${moduleKey}_enabled`] === true) return;

  throw new Error(
    `${MODULE_LABELS[moduleKey]} isn't included on this chamber's plan yet — contact chambers@lexdiary.online to add it.`,
  );
}
