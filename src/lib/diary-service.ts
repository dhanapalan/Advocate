import { supabase } from "@/integrations/supabase/client";

// Client-side entry point for the Diary & Cause-list microservice
// (services/diary/) — Phase 3 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Same
// direct-from-browser trust model as src/lib/clients-service.ts. Diary and
// Cause List are bundled into one service (and one sellable module,
// "diary") because reconcileHearing couples them too tightly to split.
//
// listMatterHearings and listMatterCauseListHistory were NOT ported —
// nothing in the app called either (grep-confirmed before extraction).
const DIARY_SERVICE_URL =
  import.meta.env["VITE_DIARY_SERVICE_URL"] ||
  "https://lexdiary-diary.dhanapalan-advocate.workers.dev";

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in.");

  return fetch(`${DIARY_SERVICE_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

async function parseOrThrow<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) message = body.error;
  } catch {
    // Body wasn't JSON — fall through to the generic message.
  }
  throw new Error(message);
}

// ---------------------------------------------------------------- hearings

export type HearingRecord = {
  id: string;
  matter_title: string;
  court: string | null;
  hearing_date: string;
  hearing_time: string | null;
  purpose: string | null;
  status: string;
  created_at: string;
};

export async function listHearings(): Promise<HearingRecord[]> {
  return parseOrThrow<HearingRecord[]>(await authedFetch("/api/v1/hearings"));
}

export async function createHearing(input: {
  matterTitle: string;
  court?: string;
  hearingDate: string;
  hearingTime?: string;
  purpose?: string;
}): Promise<HearingRecord> {
  return parseOrThrow<HearingRecord>(
    await authedFetch("/api/v1/hearings", { method: "POST", body: JSON.stringify(input) }),
  );
}

export async function updateHearingStatus(input: {
  id: string;
  status: "confirmed" | "cause_list_awaited" | "adjourned" | "completed";
}): Promise<{ ok: true }> {
  return parseOrThrow<{ ok: true }>(
    await authedFetch(`/api/v1/hearings/${input.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: input.status }),
    }),
  );
}

// -------------------------------------------------------------- cause list

export type CauseListSource = {
  id: string;
  court: string;
  bench: string | null;
  list_type: string;
  source_type: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_attempt_at: string | null;
  sync_status: string;
  error_message: string | null;
  created_at: string;
};

export async function getCauseListFeatureEnabled(): Promise<{ enabled: boolean }> {
  return parseOrThrow(await authedFetch("/api/v1/cause-list/feature-enabled"));
}

export async function listCauseListSources(): Promise<CauseListSource[]> {
  return parseOrThrow(await authedFetch("/api/v1/cause-list/sources"));
}

export async function createCauseListSource(input: {
  court: string;
  bench?: string;
  listType?: "daily" | "supplementary" | "special";
}): Promise<CauseListSource> {
  return parseOrThrow(
    await authedFetch("/api/v1/cause-list/sources", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function setCauseListSourceEnabled(input: {
  id: string;
  enabled: boolean;
}): Promise<{ ok: true }> {
  return parseOrThrow(
    await authedFetch(`/api/v1/cause-list/sources/${input.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: input.enabled }),
    }),
  );
}

export type IngestCauseListResult = {
  sourceId: string;
  listDate: string;
  totalRows: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  removedCount: number;
  matchedCount: number;
  needsReviewCount: number;
  unmatchedCount: number;
  parseErrors: { line: number; message: string }[];
};

export async function ingestCauseList(input: {
  sourceId: string;
  listDate: string;
  pastedText: string;
}): Promise<IngestCauseListResult> {
  return parseOrThrow(
    await authedFetch("/api/v1/cause-list/ingest", { method: "POST", body: JSON.stringify(input) }),
  );
}

export type CauseListEntry = {
  recordId: string;
  sourceId: string;
  sourceReference: string;
  court: string | null;
  bench: string | null;
  serialNumber: string | null;
  caseNumber: string | null;
  cnr: string | null;
  petitioner: string | null;
  respondent: string | null;
  advocateNames: string | null;
  stage: string | null;
  courtHall: string | null;
  hasChangedToday: boolean;
  isRemoved: boolean;
  match: {
    id: string;
    matterId: string | null;
    matterTitle: string | null;
    method: string;
    confidence: number;
    status: string;
  } | null;
  hearingId: string | null;
  hasConflict: boolean;
};

export async function listCauseListEntries(input: { date: string }): Promise<{
  date: string;
  entries: CauseListEntry[];
  summary: {
    total: number;
    newOrChanged: number;
    removed: number;
    matched: number;
    needsReview: number;
    conflicts: number;
  };
}> {
  return parseOrThrow(
    await authedFetch(`/api/v1/cause-list/entries?date=${encodeURIComponent(input.date)}`),
  );
}

export async function matchMatterManually(input: {
  matchId: string;
  matterId: string;
}): Promise<{ ok: true }> {
  return parseOrThrow(
    await authedFetch(`/api/v1/cause-list/matches/${input.matchId}/match`, {
      method: "POST",
      body: JSON.stringify({ matterId: input.matterId }),
    }),
  );
}

export async function rejectCauseListMatch(input: { matchId: string }): Promise<{ ok: true }> {
  return parseOrThrow(
    await authedFetch(`/api/v1/cause-list/matches/${input.matchId}/reject`, { method: "POST" }),
  );
}

export type CauseListChangeHistoryEntry = {
  id: string;
  record_id: string;
  change_type: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  detected_at: string;
};

export async function listCauseListChangeHistory(input: {
  sourceId: string;
  sourceReference: string;
}): Promise<CauseListChangeHistoryEntry[]> {
  const params = new URLSearchParams({
    sourceId: input.sourceId,
    sourceReference: input.sourceReference,
  });
  return parseOrThrow(await authedFetch(`/api/v1/cause-list/history?${params.toString()}`));
}
