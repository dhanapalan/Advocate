import type { SupabaseClient } from "@supabase/supabase-js";
import { handleOptions, jsonResponse, errorResponse } from "./cors";
import { authedClient, requireUserId } from "./auth";
import { requireDraftingModule } from "./require-module";
import { decryptField, encryptField } from "./field-encryption";

// LexDiary Drafting service (incl. Dictation) — Phase 6 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Owns ai_drafts
// CRUD only — the actual AI-calling work (ai-generate-draft,
// dictation-transcribe, dictation-format) stays on Supabase Edge Functions
// with their own AI_GATEWAY_API_KEY, same split Phase 4 (Documents) used
// and for the same reason: those edge functions already have their own
// requireModule("ai_drafting") gate (Phase 0), and moving AI-Gateway-calling
// logic into a Cloudflare Worker has no isolation benefit.

const LIST_COLUMNS = "id, doc_type, matter_ref, instructions, content, status, created_at";

const VALID_REVIEW_STATUSES = new Set(["pending_review", "approved", "rejected"]);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function listDrafts(req: Request, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("ai_drafts")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return errorResponse(req, error.message, 400);
  const rows = await Promise.all(
    (data ?? []).map(async (d: { content: string | null }) => ({
      ...d,
      content: await decryptField(d.content),
    })),
  );
  return jsonResponse(req, rows);
}

async function updateDraftStatus(req: Request, supabase: SupabaseClient, draftId: string) {
  if (!isUuid(draftId)) return errorResponse(req, "Invalid draft id", 400);
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.status || !VALID_REVIEW_STATUSES.has(body.status)) {
    return errorResponse(req, "status must be one of pending_review, approved, rejected");
  }

  const { error } = await supabase
    .from("ai_drafts")
    .update({ status: body.status })
    .eq("id", draftId);
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, { ok: true });
}

async function saveDraft(req: Request, supabase: SupabaseClient, draftId: string) {
  if (!isUuid(draftId)) return errorResponse(req, "Invalid draft id", 400);
  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (typeof body.content !== "string") return errorResponse(req, "content is required");

  const { error } = await supabase
    .from("ai_drafts")
    .update({ content: await encryptField(body.content) })
    .eq("id", draftId);
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, { ok: true });
}

async function saveDictatedDraft(req: Request, supabase: SupabaseClient, userId: string) {
  let body: { docType?: string; matterRef?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.docType || body.docType.trim().length === 0) {
    return errorResponse(req, "docType is required");
  }
  if (!body.content || body.content.trim().length === 0) {
    return errorResponse(req, "content is required");
  }

  const { data: saved, error } = await supabase
    .from("ai_drafts")
    .insert({
      user_id: userId,
      doc_type: body.docType,
      matter_ref: body.matterRef ?? null,
      instructions: "(Dictated)",
      content: await encryptField(body.content),
    })
    .select(LIST_COLUMNS)
    .single();
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, { ...saved, content: body.content });
}

export default {
  async fetch(req: Request): Promise<Response> {
    const preflight = handleOptions(req);
    if (preflight) return preflight;

    const auth = authedClient(req);
    if (!auth) return errorResponse(req, "Unauthorized", 401);
    const userId = await requireUserId(auth.supabase, auth.token);
    if (!userId) return errorResponse(req, "Unauthorized", 401);

    try {
      await requireDraftingModule(auth.supabase, userId);
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

    if (req.method === "GET" && path === "/api/v1/drafts") {
      return listDrafts(req, supabase);
    }
    if (req.method === "POST" && path === "/api/v1/drafts/dictated") {
      return saveDictatedDraft(req, supabase, userId);
    }
    const statusMatch = path.match(/^\/api\/v1\/drafts\/([0-9a-fA-F-]+)\/status$/);
    if (req.method === "PATCH" && statusMatch) {
      return updateDraftStatus(req, supabase, statusMatch[1]!);
    }
    const draftMatch = path.match(/^\/api\/v1\/drafts\/([0-9a-fA-F-]+)$/);
    if (req.method === "PATCH" && draftMatch) {
      return saveDraft(req, supabase, draftMatch[1]!);
    }

    return errorResponse(req, "Not found", 404);
  },
};
