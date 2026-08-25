import { handleOptions, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authedClient, requireUserId } from "../_shared/auth.ts";
import { chatComplete, enforceUsageQuota, LEGAL_SYSTEM_PROMPT } from "../_shared/ai.ts";
import { requireModule } from "../_shared/modules.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const auth = authedClient(req);
  if (!auth) return errorResponse(req, "Unauthorized", 401);
  const userId = await requireUserId(auth.supabase);
  if (!userId) return errorResponse(req, "Unauthorized", 401);
  const { supabase } = auth;

  try {
    await requireModule(supabase, userId, "ai_assistant");
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Module check failed.", 403);
  }

  try {
    await enforceUsageQuota(supabase);
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "Quota check failed.", 429);
  }

  let body: { conversationId: string | null; matterRef?: string; question: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.question?.trim()) return errorResponse(req, "question is required");

  let conversationId = body.conversationId;
  if (!conversationId) {
    const { data: created, error } = await supabase
      .from("ai_conversations")
      .insert({
        user_id: userId,
        title: body.question.slice(0, 70),
        matter_ref: body.matterRef ?? null,
      })
      .select("id")
      .single();
    if (error) return errorResponse(req, error.message, 500);
    conversationId = created.id;
  } else {
    // RLS (tenant_id = current_tenant_id()) already scopes this to the
    // caller's firm — any tenant member may continue a colleague's
    // conversation. A row coming back at all confirms it's in-tenant.
    const { data: visible } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!visible) return errorResponse(req, "Conversation not found", 404);
  }

  const { data: history } = await supabase
    .from("ai_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(40);

  let answer: string;
  try {
    answer = await chatComplete([
      { role: "system", content: LEGAL_SYSTEM_PROMPT },
      ...(body.matterRef
        ? [{ role: "system" as const, content: `Active matter: ${body.matterRef}` }]
        : []),
      ...(history ?? []).map((row: { role: string; content: string }) => ({
        role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: row.content,
      })),
      { role: "user", content: body.question },
    ]);
  } catch (cause) {
    return errorResponse(req, cause instanceof Error ? cause.message : "AI request failed.", 502);
  }

  const { error: insertError } = await supabase.from("ai_messages").insert([
    { conversation_id: conversationId, user_id: userId, role: "user", content: body.question },
    {
      conversation_id: conversationId,
      user_id: userId,
      role: "assistant",
      content: answer || "No answer was generated. Please rephrase the question.",
    },
  ]);
  if (insertError) return errorResponse(req, insertError.message, 500);

  await supabase
    .from("ai_conversations")
    .update({ matter_ref: body.matterRef ?? null })
    .eq("id", conversationId);

  return jsonResponse(req, { conversationId, answer });
});
