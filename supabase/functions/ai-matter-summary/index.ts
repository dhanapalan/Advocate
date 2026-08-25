import { handleOptions, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authedClient, requireUserId } from "../_shared/auth.ts";
import {
  chatComplete,
  enforceUsageQuota,
  extractJson,
  LEGAL_SYSTEM_PROMPT,
} from "../_shared/ai.ts";
import { requireModule } from "../_shared/modules.ts";

// K3 — Matter Intelligence. Takes the ALREADY-AGGREGATED MatterContext facts
// (see src/lib/matter-context.functions.ts) and asks the model for a short,
// grounded four-part summary. This function never queries the database for
// matter facts itself and has no way to invent one not already in the
// request body — same architecture as ai-morning-brief/index.ts. If this
// call fails, the Matter page keeps working: timeline, hearings, cause-list
// history and documents never depend on AI succeeding (see MatterAiSummary.tsx).
type MatterSummaryInput = {
  today: string;
  matter: {
    title: string;
    caseNumber: string | null;
    court: string | null;
    status: string;
    clientName: string | null;
    opposingParty: string | null;
    filedDate: string | null;
  };
  hearings: { hearingDate: string; status: string; purpose: string | null }[];
  causeListEvents: {
    changeType: string;
    detectedAt: string;
    fieldName: string | null;
    oldValue: string | null;
    newValue: string | null;
  }[];
  documentCount: number;
};

function factsBlockFor(input: MatterSummaryInput): string {
  const { today, matter, hearings, causeListEvents, documentCount } = input;
  const lines = [
    `Today's date: ${today}`,
    `Matter: ${matter.title}`,
    `Case number: ${matter.caseNumber ?? "not on record"}`,
    `Court: ${matter.court ?? "not on record"}`,
    `Status: ${matter.status}`,
    `Client: ${matter.clientName ?? "not on record"}`,
    `Opposing party: ${matter.opposingParty ?? "not on record"}`,
    `Filed: ${matter.filedDate ?? "not on record"}`,
    `Documents on record: ${documentCount}`,
    "",
    hearings.length > 0 ? "Hearings on record, chronological:" : "No hearings on record.",
    ...hearings.map(
      (h, i) =>
        `[${i + 1}] ${h.hearingDate} — status ${h.status}${h.purpose ? `, purpose: ${h.purpose}` : ""}`,
    ),
    "",
    causeListEvents.length > 0
      ? "Cause-list history for this matter, chronological:"
      : "No cause-list history on record.",
    ...causeListEvents.map(
      (c, i) =>
        `[${i + 1}] ${c.detectedAt} — ${c.changeType}${c.fieldName ? ` (${c.fieldName}: ${c.oldValue ?? "—"} -> ${c.newValue ?? "—"})` : ""}`,
    ),
  ];
  return lines.join("\n");
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const auth = authedClient(req);
  if (!auth) return errorResponse(req, "Unauthorized", 401);
  const userId = await requireUserId(auth.supabase);
  if (!userId) return errorResponse(req, "Unauthorized", 401);

  // Governance checkpoint, enforced here rather than trusted from the
  // client — same double-enforcement pattern as ai-morning-brief: a
  // platform admin can turn this off per chamber from
  // /admin/settings/integrations, and calling this function directly
  // (bypassing the UI's own check) still gets refused. tenant_id is
  // resolved explicitly first for the same reason documented there: a bare
  // licenses query from a platform-admin caller would otherwise see every
  // tenant's row and silently fail open.
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
  const integrations = (license?.integrations ?? {}) as {
    ai_matter_intelligence_enabled?: boolean;
  };
  if (integrations.ai_matter_intelligence_enabled === false) {
    return errorResponse(
      req,
      "AI matter summaries are turned off for this chamber by your workspace administrator.",
      403,
    );
  }

  // Commercial gate, distinct from the governance kill-switch above: matter
  // summaries are part of the matter_intelligence module (same as
  // ai-morning-brief and ai-generate-briefing).
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

  let body: MatterSummaryInput;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body?.matter) {
    return errorResponse(req, "matter is required");
  }

  const factsBlock = factsBlockFor(body);

  try {
    const raw = await chatComplete([
      { role: "system", content: LEGAL_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Below are the facts LexDiary has on record for one matter — its details, its full hearing history, " +
          "and its full cause-list history, in chronological order. Summarize the matter's current position for the " +
          "advocate in exactly four short parts.\n\n" +
          "Hard rules: use ONLY the facts given below. Never invent a party, date, case number, court name, order, " +
          "legal provision, procedural event, deadline or outcome that is not stated. This is not legal research or " +
          "legal advice — summarize only what is on record. If a part has nothing to report, write exactly " +
          '"Not available in LexDiary." for that part instead of guessing or inferring.\n\n' +
          'Use the "Today\'s date" fact to classify each hearing: a hearing dated on or after today is upcoming ' +
          "(relevant to currentPosition / nextEvent); a hearing dated before today has already happened (relevant " +
          "to recentDevelopment / previousActivity). Do not call a hearing on or after today's date unavailable " +
          "just because you are not told its outcome yet.\n\n" +
          "Return ONLY a JSON object, no prose outside it, in exactly this shape:\n" +
          '{"currentPosition": "...", "recentDevelopment": "...", "previousActivity": "...", "nextEvent": "..."}\n\n' +
          "- currentPosition: the matter's current status and, if there is one, its next scheduled hearing (a " +
          "hearing dated on or after today).\n" +
          "- recentDevelopment: what happened at the most recent hearing or cause-list event dated before today, " +
          "if any.\n" +
          "- previousActivity: what happened before that, if there is an earlier past event to report.\n" +
          "- nextEvent: the date of the next hearing dated on or after today, if one is on record, otherwise say " +
          "so plainly.\n\n" +
          factsBlock,
      },
    ]);

    const parsed = extractJson(raw) as Record<string, unknown> | null;
    if (
      !parsed ||
      typeof parsed.currentPosition !== "string" ||
      typeof parsed.recentDevelopment !== "string" ||
      typeof parsed.previousActivity !== "string" ||
      typeof parsed.nextEvent !== "string"
    ) {
      return errorResponse(req, "AI returned an unexpected format.", 502);
    }
    return jsonResponse(req, {
      summary: {
        currentPosition: parsed.currentPosition,
        recentDevelopment: parsed.recentDevelopment,
        previousActivity: parsed.previousActivity,
        nextEvent: parsed.nextEvent,
      },
    });
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "AI request failed.", 502);
  }
});
