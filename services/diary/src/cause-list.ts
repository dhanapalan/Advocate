import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, errorResponse } from "./cors";
import { encryptField } from "./field-encryption";
import { getCauseListEnabled } from "./tenant-integrations";
import { parseBulkCauseList } from "./cause-list-parse";
import { matchCauseListRecord, type MatchStatus, type RecordToMatch } from "./cause-list-matching";
import { detectChanges, findRemovedReferences, type ComparableRecord } from "./cause-list-changes";

// Ported verbatim from cause-list.functions.ts. listMatterCauseListHistory
// was NOT ported — grep confirmed nothing in the app called it (same dead-
// code situation as diary.functions.ts's listMatterHearings).

type CauseListRecordRow = {
  id: string;
  source_id: string;
  source_reference: string;
  list_date: string;
  court: string | null;
  bench: string | null;
  court_hall: string | null;
  serial_number: string | null;
  cnr: string | null;
  stage: string | null;
};
type CauseListMatchRow = {
  id: string;
  record_id: string;
  matter_id: string | null;
  match_method: string;
  confidence: number;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
};
type HearingRow = {
  id: string;
  cause_list_record_id: string | null;
  hearing_date: string;
  hearing_time: string | null;
  matter_id: string | null;
  matter_title: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function toComparable(row: {
  list_date: string;
  serial_number: string | null;
  court_hall: string | null;
  bench: string | null;
  stage: string | null;
}): ComparableRecord {
  return {
    listDate: row.list_date,
    serialNumber: row.serial_number,
    courtHall: row.court_hall,
    bench: row.bench,
    stage: row.stage,
  };
}

function normalizeCnrKey(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "");
}

// Reconciliation for the single-record manual-match path (matchMatterManually
// below) — the atomic multi-row ingestCauseList path uses the
// ingest_cause_list_row() Postgres function instead (see the
// 20260826120000_atomic_cause_list_ingestion.sql migration comment for why).
//
// SYNC WARNING: this find-or-create logic (version-chain hearing, else
// same-matter/same-date, else insert) is independently reimplemented in
// ingest_cause_list_row()'s SQL — no test or type contract ties the two
// together, only this comment. If you change the matching precedence, the
// insert/update fields, or any other part of this logic, the SQL function
// (20260826120000_atomic_cause_list_ingestion.sql, and any later migration
// that CREATE OR REPLACEs it) needs the identical change, or the automated
// cause-list-ingest path and this manual-match path will silently diverge.
async function reconcileHearing(
  supabase: SupabaseClient,
  userId: string,
  record: CauseListRecordRow,
  matterId: string,
  matterTitle: string,
) {
  const { data: priorVersionIds } = await supabase
    .from("cause_list_records")
    .select("id")
    .eq("source_id", record.source_id)
    .eq("source_reference", record.source_reference);
  const versionIds = (priorVersionIds ?? []).map((r: { id: string }) => r.id);

  const { data: linkedHearing } = await supabase
    .from("hearings")
    .select("id")
    .in("cause_list_record_id", versionIds.length > 0 ? versionIds : [record.id])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: sameDateHearing } = linkedHearing
    ? { data: null }
    : await supabase
        .from("hearings")
        .select("id")
        .eq("matter_id", matterId)
        .eq("hearing_date", record.list_date)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const existingHearing = linkedHearing ?? sameDateHearing;

  if (existingHearing) {
    await supabase
      .from("hearings")
      .update({
        matter_id: matterId,
        hearing_date: record.list_date,
        court: record.court,
        court_hall: record.court_hall,
        bench: record.bench,
        cnr: record.cnr,
        cause_list_record_id: record.id,
      })
      .eq("id", existingHearing.id);
    return;
  }

  await supabase.from("hearings").insert({
    matter_id: matterId,
    matter_title: matterTitle,
    court: record.court,
    hearing_date: record.list_date,
    hearing_time: null,
    purpose: await encryptField(record.stage),
    status: "confirmed",
    court_hall: record.court_hall,
    bench: record.bench,
    cnr: record.cnr,
    cause_list_record_id: record.id,
    created_by: userId,
  });
}

export async function getCauseListFeatureEnabled(
  req: Request,
  supabase: SupabaseClient,
  userId: string,
) {
  const enabled = await getCauseListEnabled(supabase, userId);
  return jsonResponse(req, { enabled });
}

export async function listCauseListSources(req: Request, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("cause_list_sources")
    .select(
      "id, court, bench, list_type, source_type, enabled, last_sync_at, last_attempt_at, sync_status, error_message, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, data ?? []);
}

export async function createCauseListSource(
  req: Request,
  supabase: SupabaseClient,
  userId: string,
) {
  let body: { court?: string; bench?: string; listType?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.court || body.court.trim().length < 2) {
    return errorResponse(req, "court must be at least 2 characters");
  }
  if (body.listType && !["daily", "supplementary", "special"].includes(body.listType)) {
    return errorResponse(req, "listType must be one of daily, supplementary, special");
  }

  const { data: saved, error } = await supabase
    .from("cause_list_sources")
    .insert({
      court: body.court,
      bench: body.bench ?? null,
      list_type: body.listType ?? "daily",
      source_type: "manual_import",
      created_by: userId,
    })
    .select(
      "id, court, bench, list_type, source_type, enabled, last_sync_at, last_attempt_at, sync_status, error_message, created_at",
    )
    .single();
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, saved);
}

export async function setCauseListSourceEnabled(
  req: Request,
  supabase: SupabaseClient,
  sourceId: string,
) {
  if (!isUuid(sourceId)) return errorResponse(req, "Invalid source id", 400);
  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (typeof body.enabled !== "boolean") return errorResponse(req, "enabled must be a boolean");

  const { error } = await supabase
    .from("cause_list_sources")
    .update({ enabled: body.enabled })
    .eq("id", sourceId);
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, { ok: true });
}

export async function ingestCauseList(req: Request, supabase: SupabaseClient, userId: string) {
  let body: { sourceId?: string; listDate?: string; pastedText?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.sourceId || !isUuid(body.sourceId))
    return errorResponse(req, "sourceId must be a UUID");
  if (!body.listDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.listDate)) {
    return errorResponse(req, "listDate must be YYYY-MM-DD");
  }
  if (!body.pastedText || body.pastedText.length === 0) {
    return errorResponse(req, "pastedText is required");
  }
  const { sourceId, listDate, pastedText } = body as {
    sourceId: string;
    listDate: string;
    pastedText: string;
  };

  const now = new Date().toISOString();

  const causeListEnabled = await getCauseListEnabled(supabase, userId);
  if (!causeListEnabled) {
    return errorResponse(
      req,
      "Cause List Intelligence is turned off for this chamber by your workspace administrator.",
      403,
    );
  }

  const { data: source, error: sourceError } = await supabase
    .from("cause_list_sources")
    .select("*")
    .eq("id", sourceId)
    .single();
  if (sourceError) return errorResponse(req, sourceError.message, 400);
  if (!source.enabled) {
    return errorResponse(
      req,
      "This cause-list source is disabled — enable it before importing a list.",
    );
  }

  const { rows, errors: parseErrors } = parseBulkCauseList(pastedText, listDate);

  const dedupedByRef = new Map<string, (typeof rows)[number]>();
  const duplicateLines: number[] = [];
  for (const row of rows) {
    if (dedupedByRef.has(row.sourceReference)) duplicateLines.push(row.line);
    dedupedByRef.set(row.sourceReference, row);
  }
  const dedupedRows = [...dedupedByRef.values()];
  const currentReferences = new Set(dedupedRows.map((r) => r.sourceReference));

  if (dedupedRows.length === 0) {
    await supabase
      .from("cause_list_sources")
      .update({
        last_attempt_at: now,
        sync_status: "failed",
        error_message: "No usable rows found in the pasted text.",
      })
      .eq("id", source.id);
    return jsonResponse(req, {
      sourceId: source.id,
      listDate,
      totalRows: 0,
      newCount: 0,
      changedCount: 0,
      unchangedCount: 0,
      removedCount: 0,
      matchedCount: 0,
      needsReviewCount: 0,
      unmatchedCount: 0,
      parseErrors,
    });
  }

  const [{ data: matters, error: mattersError }, { data: profile }] = await Promise.all([
    supabase.from("matters").select("id, title, case_number, court, opposing_party").limit(500),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  if (mattersError) return errorResponse(req, mattersError.message, 400);
  const candidates = (matters ?? []).map(
    (m: {
      id: string;
      title: string;
      case_number: string | null;
      court: string | null;
      opposing_party: string | null;
    }) => ({
      id: m.id,
      title: m.title,
      caseNumber: m.case_number,
      court: m.court,
      opposingParty: m.opposing_party,
    }),
  );
  const advocateName = profile?.full_name ?? null;

  const { data: headRecords, error: headError } = await supabase
    .from("cause_list_records")
    .select("*")
    .eq("source_id", source.id)
    .is("superseded_by", null);
  if (headError) return errorResponse(req, headError.message, 400);
  const headByRef = new Map(
    (headRecords ?? []).map((r: CauseListRecordRow) => [r.source_reference, r]),
  );

  const headIds = (headRecords ?? []).map((r: CauseListRecordRow) => r.id);
  const { data: headMatches } = headIds.length
    ? await supabase.from("cause_list_matches").select("*").in("record_id", headIds)
    : { data: [] as CauseListMatchRow[] };
  const matchByRecordId = new Map(
    (headMatches ?? []).map((m: CauseListMatchRow) => [m.record_id, m]),
  );

  const { data: matchedCnrRows } = await supabase
    .from("cause_list_matches")
    .select("matter_id, created_at, cause_list_records!inner(cnr)")
    .eq("status", "matched")
    .not("cause_list_records.cnr", "is", null)
    .order("created_at", { ascending: false });
  const priorCnrMap = new Map<string, string>();
  for (const row of matchedCnrRows ?? []) {
    const cnr = (row as unknown as { cause_list_records: { cnr: string | null } })
      .cause_list_records.cnr;
    if (!cnr) continue;
    const key = normalizeCnrKey(cnr);
    if (!priorCnrMap.has(key)) priorCnrMap.set(key, (row as { matter_id: string }).matter_id);
  }

  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let matchedCount = 0;
  let needsReviewCount = 0;
  let unmatchedCount = 0;

  for (const row of dedupedRows) {
    const previous = headByRef.get(row.sourceReference) ?? null;
    const previousMatch = previous ? (matchByRecordId.get(previous.id) ?? null) : null;

    const current: ComparableRecord = {
      listDate,
      serialNumber: row.serialNumber,
      courtHall: row.courtHall,
      bench: source.bench,
      stage: row.stage,
    };
    const changes = detectChanges(previous ? toComparable(previous) : null, current);
    if (!previous) newCount++;
    else if (changes.some((c) => c.changeType !== "unchanged")) changedCount++;
    else unchangedCount++;

    let matchResult: {
      matterId: string | null;
      method: string;
      confidence: number;
      status: MatchStatus;
    };
    if (previousMatch?.status === "matched" && previousMatch.matter_id) {
      matchResult = {
        matterId: previousMatch.matter_id,
        method: previousMatch.match_method,
        confidence: previousMatch.confidence,
        status: "matched",
      };
    } else {
      const recordToMatch: RecordToMatch = {
        caseNumber: row.caseNumber,
        cnr: row.cnr,
        court: source.court,
        petitioner: row.petitioner,
        respondent: row.respondent,
        advocateNames: row.advocateNames,
      };
      const priorCnrMatterId = row.cnr ? (priorCnrMap.get(normalizeCnrKey(row.cnr)) ?? null) : null;
      matchResult = matchCauseListRecord(recordToMatch, candidates, priorCnrMatterId, advocateName);
    }

    if (matchResult.status === "matched") matchedCount++;
    else if (matchResult.status === "needs_review") needsReviewCount++;
    else unmatchedCount++;

    const carryReview = previousMatch?.status === "matched";
    const matchedMatter =
      matchResult.status === "matched" && matchResult.matterId
        ? candidates.find((m) => m.id === matchResult.matterId)
        : undefined;

    const { error: ingestError } = await supabase.rpc("ingest_cause_list_row", {
      p_source_id: source.id,
      p_list_date: listDate,
      p_court: source.court,
      p_bench: source.bench,
      p_list_type: source.list_type,
      p_serial_number: row.serialNumber,
      p_case_number: row.caseNumber,
      p_cnr: row.cnr,
      p_petitioner: row.petitioner,
      p_respondent: row.respondent,
      p_advocate_names: row.advocateNames,
      p_stage: row.stage,
      p_court_hall: row.courtHall,
      p_source_reference: row.sourceReference,
      p_raw_payload: row,
      p_created_by: userId,
      p_previous_id: previous?.id ?? null,
      p_changes: changes.map((c) => ({
        changeType: c.changeType,
        fieldName: c.fieldName,
        oldValue: c.oldValue,
        newValue: c.newValue,
      })),
      p_match_matter_id: matchResult.matterId,
      p_match_method: matchResult.method,
      p_match_confidence: matchResult.confidence,
      p_match_status: matchResult.status,
      p_carry_reviewed_by: carryReview ? previousMatch!.reviewed_by : null,
      p_carry_reviewed_at: carryReview ? previousMatch!.reviewed_at : null,
      p_reconcile_matter_title: matchedMatter?.title ?? null,
      p_reconcile_purpose_encrypted: matchedMatter ? await encryptField(row.stage) : null,
    });
    if (ingestError) return errorResponse(req, ingestError.message, 400);
  }

  const removedRefs = findRemovedReferences([...headByRef.keys()], currentReferences);
  for (const ref of removedRefs) {
    const record = headByRef.get(ref)!;
    await supabase.from("cause_list_changes").insert({
      record_id: record.id,
      previous_record_id: null,
      change_type: "removed",
      field_name: null,
      old_value: null,
      new_value: null,
    });
  }

  const errorSummary =
    duplicateLines.length > 0 || parseErrors.length > 0
      ? `${parseErrors.length} row(s) skipped, ${duplicateLines.length} duplicate reference(s) collapsed to their last occurrence.`
      : null;

  await supabase
    .from("cause_list_sources")
    .update({
      last_sync_at: now,
      last_attempt_at: now,
      sync_status: parseErrors.length > 0 ? "partial" : "success",
      error_message: errorSummary,
    })
    .eq("id", source.id);

  return jsonResponse(req, {
    sourceId: source.id,
    listDate,
    totalRows: dedupedRows.length,
    newCount,
    changedCount,
    unchangedCount,
    removedCount: removedRefs.length,
    matchedCount,
    needsReviewCount,
    unmatchedCount,
    parseErrors,
  });
}

export async function listCauseListEntries(req: Request, supabase: SupabaseClient, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errorResponse(req, "date must be YYYY-MM-DD");

  const { data: records, error: recordsError } = await supabase
    .from("cause_list_records")
    .select(
      "id, source_id, list_date, court, bench, serial_number, case_number, cnr, petitioner, respondent, advocate_names, stage, court_hall, source_reference, created_at",
    )
    .eq("list_date", date)
    .is("superseded_by", null)
    .order("serial_number", { ascending: true, nullsFirst: false });
  if (recordsError) return errorResponse(req, recordsError.message, 400);

  const recordIds = (records ?? []).map((r: { id: string }) => r.id);
  const [{ data: matches }, { data: changesToday }, { data: hearings }] = await Promise.all([
    recordIds.length
      ? supabase.from("cause_list_matches").select("*").in("record_id", recordIds)
      : Promise.resolve({ data: [] as CauseListMatchRow[] }),
    recordIds.length
      ? supabase
          .from("cause_list_changes")
          .select("record_id, change_type, detected_at")
          .in("record_id", recordIds)
          .neq("change_type", "unchanged")
          .order("detected_at", { ascending: true })
      : Promise.resolve({
          data: [] as { record_id: string; change_type: string; detected_at: string }[],
        }),
    recordIds.length
      ? supabase
          .from("hearings")
          .select("id, cause_list_record_id, hearing_date, hearing_time, matter_id, matter_title")
          .in("cause_list_record_id", recordIds)
      : Promise.resolve({ data: [] as HearingRow[] }),
  ]);

  const matchByRecordId = new Map((matches ?? []).map((m: CauseListMatchRow) => [m.record_id, m]));
  const latestChangeByRecordId = new Map<string, string>();
  for (const c of changesToday ?? []) latestChangeByRecordId.set(c.record_id, c.change_type);
  const hearingByRecordId = new Map(
    (hearings ?? [])
      .filter((h: HearingRow) => h.cause_list_record_id)
      .map((h: HearingRow): [string, HearingRow] => [h.cause_list_record_id!, h]),
  );

  const matterIds = [
    ...new Set(
      (matches ?? [])
        .map((m: CauseListMatchRow) => m.matter_id)
        .filter((id: string | null): id is string => !!id),
    ),
  ];
  const { data: matters } = matterIds.length
    ? await supabase.from("matters").select("id, title").in("id", matterIds)
    : { data: [] as { id: string; title: string }[] };
  const matterTitleById = new Map(
    (matters ?? []).map((m: { id: string; title: string }) => [m.id, m.title]),
  );

  const dayHearings = (hearings ?? []).filter((h: HearingRow) => h.hearing_date === date);
  const clashKeys = new Set<string>();
  const seenTimes = new Map<string, number>();
  for (const h of dayHearings) {
    if (!h.hearing_time) continue;
    const key = `${h.hearing_date}|${h.hearing_time}`;
    seenTimes.set(key, (seenTimes.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seenTimes) if (count > 1) clashKeys.add(key);

  const entries = (records ?? []).map((r: CauseListRecordRow) => {
    const match = matchByRecordId.get(r.id) ?? null;
    const hearing = hearingByRecordId.get(r.id) ?? null;
    const hasConflict = !!(
      hearing?.hearing_time && clashKeys.has(`${hearing.hearing_date}|${hearing.hearing_time}`)
    );
    const latestChange = latestChangeByRecordId.get(r.id) ?? null;
    const isRemoved = latestChange === "removed";
    return {
      recordId: r.id,
      sourceId: r.source_id,
      sourceReference: r.source_reference,
      court: r.court,
      bench: r.bench,
      serialNumber: r.serial_number,
      caseNumber: (r as unknown as { case_number: string | null }).case_number,
      cnr: r.cnr,
      petitioner: (r as unknown as { petitioner: string | null }).petitioner,
      respondent: (r as unknown as { respondent: string | null }).respondent,
      advocateNames: (r as unknown as { advocate_names: string | null }).advocate_names,
      stage: r.stage,
      courtHall: r.court_hall,
      hasChangedToday: !!latestChange && !isRemoved,
      isRemoved,
      match: match
        ? {
            id: match.id,
            matterId: match.matter_id,
            matterTitle: match.matter_id ? (matterTitleById.get(match.matter_id) ?? null) : null,
            method: match.match_method,
            confidence: match.confidence,
            status: match.status,
          }
        : null,
      hearingId: hearing?.id ?? null,
      hasConflict,
    };
  });

  const summary = {
    total: entries.length,
    newOrChanged: entries.filter((e) => e.hasChangedToday).length,
    removed: entries.filter((e) => e.isRemoved).length,
    matched: entries.filter((e) => e.match?.status === "matched").length,
    needsReview: entries.filter((e) => e.match?.status === "needs_review").length,
    conflicts: entries.filter((e) => e.hasConflict).length,
  };

  return jsonResponse(req, { date, entries, summary });
}

export async function matchMatterManually(
  req: Request,
  supabase: SupabaseClient,
  userId: string,
  matchId: string,
) {
  if (!isUuid(matchId)) return errorResponse(req, "Invalid match id", 400);
  let body: { matterId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.matterId || !isUuid(body.matterId))
    return errorResponse(req, "matterId must be a UUID");

  const { data: match, error: matchError } = await supabase
    .from("cause_list_matches")
    .select("*")
    .eq("id", matchId)
    .single();
  if (matchError) return errorResponse(req, matchError.message, 400);

  const { data: matter, error: matterError } = await supabase
    .from("matters")
    .select("id, title")
    .eq("id", body.matterId)
    .single();
  if (matterError) return errorResponse(req, matterError.message, 400);

  const { error: updateError } = await supabase
    .from("cause_list_matches")
    .update({
      matter_id: body.matterId,
      match_method: "manual",
      confidence: 1,
      status: "matched",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", match.id);
  if (updateError) return errorResponse(req, updateError.message, 400);

  const { data: record, error: recordError } = await supabase
    .from("cause_list_records")
    .select("*")
    .eq("id", match.record_id)
    .single();
  if (recordError) return errorResponse(req, recordError.message, 400);

  await reconcileHearing(supabase, userId, record, matter.id, matter.title);
  return jsonResponse(req, { ok: true });
}

export async function rejectCauseListMatch(
  req: Request,
  supabase: SupabaseClient,
  userId: string,
  matchId: string,
) {
  if (!isUuid(matchId)) return errorResponse(req, "Invalid match id", 400);
  const { error } = await supabase
    .from("cause_list_matches")
    .update({
      matter_id: null,
      status: "rejected",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", matchId);
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, { ok: true });
}

export async function listCauseListChangeHistory(
  req: Request,
  supabase: SupabaseClient,
  sourceId: string,
  sourceReference: string,
) {
  if (!isUuid(sourceId)) return errorResponse(req, "Invalid source id", 400);
  if (!sourceReference) return errorResponse(req, "sourceReference is required");

  const { data: versions, error: versionsError } = await supabase
    .from("cause_list_records")
    .select("id, list_date, created_at")
    .eq("source_id", sourceId)
    .eq("source_reference", sourceReference)
    .order("created_at", { ascending: true });
  if (versionsError) return errorResponse(req, versionsError.message, 400);

  const versionIds = (versions ?? []).map((v: { id: string }) => v.id);
  if (versionIds.length === 0) return jsonResponse(req, []);

  const { data: changes, error: changesError } = await supabase
    .from("cause_list_changes")
    .select("id, record_id, change_type, field_name, old_value, new_value, detected_at")
    .in("record_id", versionIds)
    .order("detected_at", { ascending: true });
  if (changesError) return errorResponse(req, changesError.message, 400);
  return jsonResponse(req, changes ?? []);
}
