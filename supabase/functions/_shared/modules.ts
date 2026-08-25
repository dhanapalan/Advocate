export type ModuleKey =
  "ai_drafting" | "ai_assistant" | "matter_intelligence" | "ocr" | "dictation";

const MODULE_LABELS: Record<ModuleKey, string> = {
  ai_drafting: "AI drafting",
  ai_assistant: "the AI case assistant",
  matter_intelligence: "AI matter intelligence",
  ocr: "OCR document intake",
  dictation: "Dictation",
};

/**
 * Per-tenant paid-module gate. Trial tenants get every module unlocked to
 * evaluate — same policy as the rest of the app (see
 * 20260820020000_trial_unlocks_all_features.sql). Once on a paid plan, a
 * module is available only once licenses.integrations has
 * "{module}_enabled": true set for it — opt-in, unlike the older governance
 * kill-switches (ai_morning_brief_enabled, ai_matter_intelligence_enabled,
 * ai_case_intelligence_enabled), which default to true and only ever turn a
 * feature OFF. Both kinds of flag live in the same JSONB column and can
 * coexist on the same feature: a kill-switch can still force a purchased
 * module off, but a kill-switch defaulting true never turns an unpurchased
 * module on. Toggled per tenant from /admin/settings/integrations.
 */
export async function requireModule(
  supabase: import("jsr:@supabase/supabase-js@2").SupabaseClient,
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
