import type { SupabaseClient } from "@supabase/supabase-js";
import { handleOptions, jsonResponse, errorResponse, dbError } from "./cors";
import { rateLimitResponse, type RateLimitEnv } from "./rate-limit";
import { authedClient, requireUserId } from "./auth";
import { requireAssistantModule } from "./require-module";

// LexDiary AI Assistant service — Phase 6 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Owns
// ai_conversations/ai_messages CRUD only — the actual AI-calling work
// (ai-assistant, ai-ask-case) stays on Supabase Edge Functions with their
// own AI_GATEWAY_API_KEY, same split Phase 4 (Documents) and this pass's
// Drafting service used. No FIELD_ENCRYPTION_KEY — neither table has an
// encrypted column.
//
// listMessages is also used by AskMyCase.tsx (K4 Ask My Case), which reuses
// this same table pair rather than a second conversation model — see that
// component's header comment. Gated on "ai_assistant" exactly as the
// original ai.functions.ts was, even though it's reached from a
// matter_intelligence/ask-case flow — preserving existing behavior, not
// introducing a new cross-module dependency.

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function listConversations(req: Request, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, matter_ref, updated_at")
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) return dbError(req, error, "Could not load your conversations.");
  return jsonResponse(req, data ?? []);
}

async function listMessages(req: Request, supabase: SupabaseClient, conversationId: string) {
  if (!isUuid(conversationId)) return errorResponse(req, "Invalid conversation id", 400);

  // RLS (tenant_id = current_tenant_id()) already scopes this to the
  // caller's firm — a row coming back at all confirms it's in-tenant.
  const { data: visible } = await supabase
    .from("ai_conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!visible) return errorResponse(req, "Conversation not found", 404);

  const { data: rows, error } = await supabase
    .from("ai_messages")
    .select("id, role, content, sources, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) return dbError(req, error, "Could not load that conversation.");
  return jsonResponse(req, rows ?? []);
}

async function deleteConversation(req: Request, supabase: SupabaseClient, conversationId: string) {
  if (!isUuid(conversationId)) return errorResponse(req, "Invalid conversation id", 400);
  const { error } = await supabase.from("ai_conversations").delete().eq("id", conversationId);
  if (error) return dbError(req, error, "Could not delete that conversation.");
  return jsonResponse(req, { ok: true });
}

export default {
  async fetch(req: Request, env: RateLimitEnv): Promise<Response> {
    const preflight = handleOptions(req);
    if (preflight) return preflight;

    // Before auth: shed flood traffic at the front door (see rate-limit.ts).
    const limited = await rateLimitResponse(req, env);
    if (limited) return limited;

    const auth = authedClient(req);
    if (!auth) return errorResponse(req, "Unauthorized", 401);
    const userId = await requireUserId(auth.supabase, auth.token);
    if (!userId) return errorResponse(req, "Unauthorized", 401);

    try {
      await requireAssistantModule(auth.supabase, userId);
    } catch (cause) {
      return errorResponse(
        req,
        cause instanceof Error ? cause.message : "Module check failed.",
        403,
      );
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const { supabase } = auth;

    if (req.method === "GET" && path === "/api/v1/conversations") {
      return listConversations(req, supabase);
    }
    const messagesMatch = path.match(/^\/api\/v1\/conversations\/([0-9a-fA-F-]+)\/messages$/);
    if (req.method === "GET" && messagesMatch) {
      return listMessages(req, supabase, messagesMatch[1]!);
    }
    const conversationMatch = path.match(/^\/api\/v1\/conversations\/([0-9a-fA-F-]+)$/);
    if (req.method === "DELETE" && conversationMatch) {
      return deleteConversation(req, supabase, conversationMatch[1]!);
    }

    return errorResponse(req, "Not found", 404);
  },
};
