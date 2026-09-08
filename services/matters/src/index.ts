import type { SupabaseClient } from "@supabase/supabase-js";
import { handleOptions, jsonResponse, errorResponse, dbError } from "./cors";
import { authedClient, requireUserId } from "./auth";
import { requireMattersModule } from "./require-module";
import { encryptField } from "./field-encryption";

// LexDiary Matters service — Phase 2 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Matters is the
// plan's "soft-hub": hearings/time_entries/invoices/cause_list_matches carry
// a nullable matter_id, and ai_documents/ai_drafts/ai_conversations only
// ever reference it by free-text matter_ref — nothing has a hard FK into
// this table, so extracting its CRUD doesn't break any other table's
// integrity. The read-heavy aggregators that assemble a matter's full
// picture (getMatterContext, getMorningBrief) stay in the main app doing
// direct-SQL reads under the user's own JWT — RLS protects those exactly as
// well as if this service answered them, so there is no reason to route
// them through here (see the plan's "capability tokens gate writes, not
// reads" section). Same no-service-role-key, browser-calls-directly pattern
// as services/clients/ — see src/lib/matters-service.ts.
//
// getMatter (single-matter fetch) was NOT ported: grep confirmed nothing in
// the app calls matters.functions.ts's old getMatter export — the matter
// detail page reads via getMatterContext instead. Porting unused surface
// just to have it would mean maintaining decrypt logic nothing exercises.

const LIST_COLUMNS =
  "id, title, client_name, case_number, court, status, opposing_party, filed_date, created_at";
const WRITE_COLUMNS =
  "id, title, client_name, case_number, court, status, opposing_party, filed_date, notes, created_at";

type MatterInput = {
  title?: string;
  clientName?: string;
  caseNumber?: string;
  court?: string;
  opposingParty?: string;
  filedDate?: string;
  status?: string;
  notes?: string;
};

const VALID_STATUSES = new Set(["active", "closed", "archived"]);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function listMatters(req: Request, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("matters")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return dbError(req, error, "Could not load your cases.");
  return jsonResponse(req, data ?? []);
}

async function createMatter(req: Request, supabase: SupabaseClient, userId: string) {
  let body: MatterInput;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.title || body.title.trim().length < 2) {
    return errorResponse(req, "title must be at least 2 characters");
  }

  const { data: saved, error } = await supabase
    .from("matters")
    .insert({
      title: body.title,
      client_name: body.clientName ?? null,
      case_number: body.caseNumber ?? null,
      court: body.court ?? null,
      opposing_party: body.opposingParty ?? null,
      filed_date: body.filedDate ?? null,
      created_by: userId,
    })
    .select(LIST_COLUMNS)
    .single();
  if (error) return dbError(req, error, "Could not create that case.");
  return jsonResponse(req, saved);
}

async function updateMatter(req: Request, supabase: SupabaseClient, matterId: string) {
  if (!isUuid(matterId)) return errorResponse(req, "Invalid matter id", 400);
  let body: MatterInput;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.title || body.title.trim().length < 2) {
    return errorResponse(req, "title must be at least 2 characters");
  }
  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return errorResponse(req, "status must be one of active, closed, archived");
  }

  const { data: saved, error } = await supabase
    .from("matters")
    .update({
      title: body.title,
      client_name: body.clientName ?? null,
      case_number: body.caseNumber ?? null,
      court: body.court ?? null,
      opposing_party: body.opposingParty ?? null,
      filed_date: body.filedDate ?? null,
      status: body.status,
      notes: await encryptField(body.notes),
    })
    .eq("id", matterId)
    .select(WRITE_COLUMNS)
    .single();
  if (error) return dbError(req, error, "Could not update that case.");
  // Caller already has the plaintext it sent — return that rather than
  // decrypting what was just written back, same as the original
  // matters.functions.ts.
  return jsonResponse(req, { ...saved, notes: body.notes ?? null });
}

async function deleteMatter(req: Request, supabase: SupabaseClient, matterId: string) {
  if (!isUuid(matterId)) return errorResponse(req, "Invalid matter id", 400);
  const { error, count } = await supabase
    .from("matters")
    .delete({ count: "exact" })
    .eq("id", matterId);
  if (error) return dbError(req, error, "Could not delete that case.");
  if (!count) {
    return errorResponse(req, "Matter not found, or you don't have permission to delete it.", 404);
  }
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
      await requireMattersModule(auth.supabase, userId);
    } catch (cause) {
      return errorResponse(
        req,
        cause instanceof Error ? cause.message : "Module check failed.",
        403,
      );
    }

    const url = new URL(req.url);
    const match = url.pathname.match(/^\/api\/v1\/matters\/?([0-9a-fA-F-]*)$/);
    if (!match) return errorResponse(req, "Not found", 404);
    const matterId = match[1];

    if (req.method === "GET" && !matterId) return listMatters(req, auth.supabase);
    if (req.method === "POST" && !matterId) return createMatter(req, auth.supabase, userId);
    if (req.method === "PATCH" && matterId) return updateMatter(req, auth.supabase, matterId);
    if (req.method === "DELETE" && matterId) return deleteMatter(req, auth.supabase, matterId);

    return errorResponse(req, "Method not allowed", 405);
  },
};
