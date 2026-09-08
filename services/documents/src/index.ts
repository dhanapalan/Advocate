import type { SupabaseClient } from "@supabase/supabase-js";
import { handleOptions, jsonResponse, errorResponse, dbError } from "./cors";
import { authedClient, requireUserId } from "./auth";
import { requireDocumentsModule } from "./require-module";

// LexDiary Documents service — Phase 4 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Owns the
// reviewed-document CRUD (ai_documents' status/list surface) only — the
// actual AI-calling work (OCR intake, AI document analysis) stays on
// Supabase Edge Functions (ocr-extract, ai-analyze-document), same as every
// other AI-calling path in this app (dictation, assistant, drafting all
// live there too, sharing the AI_GATEWAY_API_KEY secret). Extracting those
// into a Cloudflare Worker would mean re-implementing AI-Gateway-calling
// logic in a different runtime for no isolation benefit — both edge
// functions already have their own requireModule("documents") gate (Phase
// 0) and their own secrets, independent of this service.
//
// No FIELD_ENCRYPTION_KEY in this service — see wrangler.toml's comment for
// why (raw_text stays a main-app-only read via getMatterContext).

const LIST_COLUMNS =
  "id, name, matter_ref, doc_kind, summary, parties, key_dates, tags, risk_notes, status, created_at";

const VALID_STATUSES = new Set(["pending_review", "approved", "rejected"]);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function listDocumentAnalyses(req: Request, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("ai_documents")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return dbError(req, error, "Could not load your documents.");
  return jsonResponse(req, data ?? []);
}

async function updateDocumentAnalysisStatus(req: Request, supabase: SupabaseClient, docId: string) {
  if (!isUuid(docId)) return errorResponse(req, "Invalid document id", 400);
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return errorResponse(req, "status must be one of pending_review, approved, rejected");
  }

  const { error } = await supabase
    .from("ai_documents")
    .update({ status: body.status })
    .eq("id", docId);
  if (error) return dbError(req, error, "Could not update that document's review status.");
  return jsonResponse(req, { ok: true });
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
      await requireDocumentsModule(auth.supabase, userId);
    } catch (cause) {
      return errorResponse(
        req,
        cause instanceof Error ? cause.message : "Module check failed.",
        403,
      );
    }

    const url = new URL(req.url);
    const match = url.pathname.match(/^\/api\/v1\/documents\/?([0-9a-fA-F-]*)$/);
    if (!match) return errorResponse(req, "Not found", 404);
    const docId = match[1];

    if (req.method === "GET" && !docId) return listDocumentAnalyses(req, auth.supabase);
    if (req.method === "PATCH" && docId) {
      return updateDocumentAnalysisStatus(req, auth.supabase, docId);
    }

    return errorResponse(req, "Method not allowed", 405);
  },
};
