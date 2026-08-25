import { handleOptions, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authedClient, requireUserId } from "../_shared/auth.ts";
import {
  chatComplete,
  enforceUsageQuota,
  extractJson,
  LEGAL_SYSTEM_PROMPT,
} from "../_shared/ai.ts";
import { requireModule } from "../_shared/modules.ts";

// Takes the ALREADY-AGGREGATED, deterministic Court Morning Brief data (see
// src/lib/morning-brief.functions.ts) and asks the model for a short
// preparation summary per hearing. This function does not query the
// database itself and has no way to invent a fact not already in the
// request body — every field the model is given is named explicitly as
// "not on record" when absent, and the prompt instructs it to say so rather
// than infer. If this call fails for any reason, the client falls back to a
// deterministic, template-built summary from the same structured data (see
// buildDeterministicSummary in CourtMorningBrief.tsx) — the brief works
// with or without AI.
type BriefItemInput = {
  hearingId: string;
  matterTitle: string;
  court: string | null;
  hearingTime: string | null;
  purpose: string | null;
  status: string;
  previousHearing: { hearingDate: string; status: string; purpose: string | null } | null;
  documentCount: number;
  hasConflict: boolean;
  hasOverdueInvoice: boolean;
};

function factsBlockFor(item: BriefItemInput, index: number): string {
  return [
    `[${index + 1}] hearingId=${item.hearingId}`,
    `Matter: ${item.matterTitle}`,
    `Court: ${item.court ?? "not on record"}`,
    `Time today: ${item.hearingTime ?? "not on record"}`,
    `Purpose today: ${item.purpose ?? "not on record"}`,
    `Status: ${item.status}`,
    `Previous hearing: ${
      item.previousHearing
        ? `${item.previousHearing.hearingDate}, status ${item.previousHearing.status}${
            item.previousHearing.purpose ? `, purpose: ${item.previousHearing.purpose}` : ""
          }`
        : "none on record"
    }`,
    `Documents on record for this matter: ${item.documentCount}`,
    `Scheduling conflict today: ${item.hasConflict ? "yes" : "no"}`,
    `Overdue invoice for this matter: ${item.hasOverdueInvoice ? "yes" : "no"}`,
  ].join("\n");
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const auth = authedClient(req);
  if (!auth) return errorResponse(req, "Unauthorized", 401);
  const userId = await requireUserId(auth.supabase);
  if (!userId) return errorResponse(req, "Unauthorized", 401);

  // Governance checkpoint, enforced here rather than trusted from the
  // client: a platform admin can turn the AI layer off for a chamber from
  // /admin/settings/integrations independent of the deterministic Brief
  // itself. Calling this function directly (bypassing the UI's own check in
  // CourtMorningBrief.tsx) still gets refused.
  //
  // tenant_id must be resolved explicitly from the caller's own profile
  // first: the "Platform admins manage licenses" RLS policy has no tenant
  // filter, so a bare licenses query run by a platform-admin caller sees
  // every tenant's row and .maybeSingle() errors on the multiple matches —
  // silently, since only `data` is read here, which resolves this check to
  // fail-open (undefined license -> `{}` -> flag defaults enabled) exactly
  // for the accounts most likely to be testing the disable toggle.
  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  const { data: license } = profile?.tenant_id
    ? await auth.supabase
        .from("licenses")
        .select("integrations")
        .eq("tenant_id", profile.tenant_id)
        .maybeSingle()
    : { data: null };
  const integrations = (license?.integrations ?? {}) as { ai_morning_brief_enabled?: boolean };
  if (integrations.ai_morning_brief_enabled === false) {
    return errorResponse(
      req,
      "AI prep notes are turned off for this chamber by your workspace administrator.",
      403,
    );
  }

  // Commercial gate, distinct from the governance kill-switch above: the
  // Morning Brief is part of the matter_intelligence module (same as
  // ai-matter-summary and ai-generate-briefing).
  try {
    await requireModule(auth.supabase, userId, "matter_intelligence");
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Module check failed.", 403);
  }

  try {
    await enforceUsageQuota(auth.supabase);
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Quota check failed.", 429);
  }

  let body: { items: BriefItemInput[] };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return errorResponse(req, "items (non-empty array) is required");
  }

  const factsBlock = body.items.map(factsBlockFor).join("\n\n");

  try {
    const raw = await chatComplete([
      { role: "system", content: LEGAL_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Below are today's hearings for this chamber, one block per hearing, with every fact currently on record. " +
          "For EACH hearing, write a short preparation summary (2-4 sentences) covering: what the previous hearing " +
          "recorded (if any), today's likely purpose, and one or two concrete preparation points.\n\n" +
          "Hard rules: use ONLY the facts given below. Never invent a case number, court name, date, legal outcome, " +
          'order, or deadline that is not stated. If a fact is "not on record" or "none on record", say so plainly ' +
          "instead of guessing or assuming a plausible-sounding default.\n\n" +
          "Return ONLY a JSON array, no prose outside it, one object per hearing in the same order as given: " +
          '[{"hearingId": "...", "summary": "..."}]\n\n' +
          factsBlock,
      },
    ]);

    const parsed = extractJson(raw);
    if (!Array.isArray(parsed)) {
      return errorResponse(req, "AI returned an unexpected format.", 502);
    }
    return jsonResponse(req, { summaries: parsed });
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "AI request failed.", 502);
  }
});
