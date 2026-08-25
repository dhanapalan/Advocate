import { handleOptions, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authedClient, requireUserId } from "../_shared/auth.ts";
import { chatComplete, enforceUsageQuota, LEGAL_SYSTEM_PROMPT } from "../_shared/ai.ts";
import { requireModule } from "../_shared/modules.ts";
import { encryptField } from "../_shared/field-encryption.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const auth = authedClient(req);
  if (!auth) return errorResponse(req, "Unauthorized", 401);
  const userId = await requireUserId(auth.supabase);
  if (!userId) return errorResponse(req, "Unauthorized", 401);
  const { supabase } = auth;

  try {
    await requireModule(supabase, userId, "ai_drafting");
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Module check failed.", 403);
  }

  try {
    await enforceUsageQuota(supabase);
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Quota check failed.", 429);
  }

  let body: { docType: string; matterRef?: string; instructions: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.docType?.trim() || !body.instructions || body.instructions.length < 5) {
    return errorResponse(req, "docType and instructions (min 5 chars) are required");
  }

  let content: string;
  try {
    content = await chatComplete([
      { role: "system", content: LEGAL_SYSTEM_PROMPT },
      {
        role: "system",
        content:
          "This particular reply goes straight into a print-ready legal document, not a markdown renderer. Output plain text only — no **bold**, no _italics_, no # headings, no markdown lists. For emphasis or headings, use plain capitalised text on its own line instead.",
      },
      {
        role: "user",
        content: `Draft a complete, court-ready ${body.docType} following Indian drafting conventions (cause title, numbered paragraphs, prayer, verification and place/date blocks where applicable). Use [square brackets] for any detail the advocate must fill in — never invent facts, names, dates or citations.\n\nMatter: ${body.matterRef ?? "Not specified"}\n\nInstructions from the advocate:\n${body.instructions}`,
      },
    ]);
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "AI request failed.", 502);
  }

  const { data: saved, error } = await supabase
    .from("ai_drafts")
    .insert({
      user_id: userId,
      doc_type: body.docType,
      matter_ref: body.matterRef ?? null,
      instructions: body.instructions,
      content: await encryptField(content),
    })
    .select("id, doc_type, matter_ref, instructions, content, status, created_at")
    .single();
  if (error) return errorResponse(req, error.message, 500);

  // Already have the plaintext generated above — return that rather than
  // decrypting what was just written back.
  return jsonResponse(req, { ...saved, content });
});
