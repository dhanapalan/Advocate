import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, errorResponse, dbError } from "./cors";
import { decryptField, encryptField } from "./field-encryption";

// Ported from diary.functions.ts's listHearings/createHearing/
// updateHearingStatus. listMatterHearings was NOT ported — grep confirmed
// nothing in the app called it (the Matter Timeline reads hearings via
// getMatterContext's own direct query instead).

const HEARING_COLUMNS =
  "id, matter_title, court, hearing_date, hearing_time, purpose, status, created_at";

const VALID_STATUSES = new Set(["confirmed", "cause_list_awaited", "adjourned", "completed"]);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function listHearings(req: Request, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("hearings")
    .select(HEARING_COLUMNS)
    .order("hearing_date", { ascending: true })
    .limit(200);
  if (error) return dbError(req, error, "Could not load your diary.");
  const rows = await Promise.all(
    (data ?? []).map(async (h: { purpose: string | null }) => ({
      ...h,
      purpose: await decryptField(h.purpose),
    })),
  );
  return jsonResponse(req, rows);
}

export async function createHearing(req: Request, supabase: SupabaseClient, userId: string) {
  let body: {
    matterTitle?: string;
    court?: string;
    hearingDate?: string;
    hearingTime?: string;
    purpose?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.matterTitle || body.matterTitle.trim().length < 2) {
    return errorResponse(req, "matterTitle must be at least 2 characters");
  }
  if (!body.hearingDate) return errorResponse(req, "hearingDate is required");

  const { data: saved, error } = await supabase
    .from("hearings")
    .insert({
      matter_title: body.matterTitle,
      court: body.court ?? null,
      hearing_date: body.hearingDate,
      hearing_time: body.hearingTime ?? null,
      purpose: await encryptField(body.purpose),
      created_by: userId,
    })
    .select(HEARING_COLUMNS)
    .single();
  if (error) return dbError(req, error, "Could not save that hearing.");
  return jsonResponse(req, { ...saved, purpose: body.purpose ?? null });
}

export async function updateHearingStatus(
  req: Request,
  supabase: SupabaseClient,
  hearingId: string,
) {
  if (!isUuid(hearingId)) return errorResponse(req, "Invalid hearing id", 400);
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return errorResponse(
      req,
      "status must be one of confirmed, cause_list_awaited, adjourned, completed",
    );
  }

  const { error } = await supabase
    .from("hearings")
    .update({ status: body.status })
    .eq("id", hearingId);
  if (error) return dbError(req, error, "Could not update that hearing.");
  return jsonResponse(req, { ok: true });
}
