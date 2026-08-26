import { handleOptions, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authedClient, requireUserId } from "../_shared/auth.ts";
import { chatComplete, enforceUsageQuota } from "../_shared/ai.ts";
import { requireModule } from "../_shared/modules.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const auth = authedClient(req);
  if (!auth) return errorResponse(req, "Unauthorized", 401);
  const userId = await requireUserId(auth.supabase);
  if (!userId) return errorResponse(req, "Unauthorized", 401);

  try {
    await requireModule(auth.supabase, userId, "ai_drafting");
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Module check failed.", 403);
  }

  try {
    await enforceUsageQuota(auth.supabase);
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Quota check failed.", 429);
  }

  let body: { transcript: string; style: string; matter?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.transcript || !body.style)
    return errorResponse(req, "transcript and style are required");

  try {
    const text = await chatComplete([
      {
        role: "system",
        content:
          "You are a legal stenographer for an Indian advocate's chamber. Clean up dictated speech into a print-ready draft: fix punctuation and paragraphing, expand dictated instructions like 'new paragraph' or 'full stop', keep Indian legal drafting conventions, cite sections exactly as dictated, and never invent facts. Output plain text only — this goes straight into a print-ready document, not a markdown renderer. Never use markdown syntax: no **bold**, no _italics_, no # headings, no markdown lists. For headings, use plain capitalised text (e.g. LEGAL NOTICE) on its own line. Use numbered paragraphs where appropriate.",
      },
      {
        role: "user",
        content: `Document type: ${body.style}\nMatter: ${body.matter ?? "Not specified"}\n\nRaw dictation:\n${body.transcript}`,
      },
    ]);
    return jsonResponse(req, { text: text.trim() });
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Formatting failed.", 502);
  }
});
