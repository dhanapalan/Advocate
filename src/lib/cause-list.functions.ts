import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptField } from "@/lib/field-encryption";
import { parseBulkCauseList } from "@/lib/cause-list-parse";
import {
  matchCauseListRecord,
  type MatchStatus,
  type RecordToMatch,
} from "@/lib/cause-list-matching";
import {
  detectChanges,
  findRemovedReferences,
  type ComparableRecord,
} from "@/lib/cause-list-changes";
import { getOwnIntegrations } from "@/lib/tenant-integrations";
import { requireModule } from "@/lib/require-module";
import type { Database } from "@/integrations/supabase/types";

// Tenant-scoped cause-list CRUD, ingestion and matching. Same trust model as
// diary.functions.ts: tenant_id is never accepted from the client, RLS
// derives and enforces it. No AI is involved anywhere in this file —
// matching, change detection and reconciliation are pure, explainable logic
// (see cause-list-matching.ts / cause-list-changes.ts).

type CauseListRecordRow = Database["public"]["Tables"]["cause_list_records"]["Row"];
type CauseListMatchRow = Database["public"]["Tables"]["cause_list_matches"]["Row"];

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

// Client-side governance check — lets the Diary Portal hide the import UI
// entirely (not just disable a button) when a platform admin has turned
// Cause List Intelligence off for this chamber. The real enforcement is the
// identical check inside ingestCauseList itself, which this can't bypass.
export const getCauseListFeatureEnabled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const integrations = await getOwnIntegrations(context.supabase, context.userId);
    return { enabled: integrations.cause_list_enabled ?? true };
  });

export const listCauseListSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireModule(context.supabase, context.userId, "diary");
    const { data, error } = await context.supabase
      .from("cause_list_sources")
      .select(
        "id, court, bench, list_type, source_type, enabled, last_sync_at, last_attempt_at, sync_status, error_message, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createCauseListSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        court: z.string().min(2),
        bench: z.string().optional(),
        listType: z.enum(["daily", "supplementary", "special"]).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "diary");
    const { data: saved, error } = await context.supabase
      .from("cause_list_sources")
      .insert({
        court: data.court,
        bench: data.bench ?? null,
        list_type: data.listType ?? "daily",
        source_type: "manual_import",
        created_by: context.userId,
      })
      .select(
        "id, court, bench, list_type, source_type, enabled, last_sync_at, last_attempt_at, sync_status, error_message, created_at",
      )
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const setCauseListSourceEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "diary");
    const { error } = await context.supabase
      .from("cause_list_sources")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Finds (or creates) the hearing this cause-list listing reconciles to,
// touching only source-derived fields. matter_title/purpose/status are set
// on create only — an advocate's own edits to those on an existing hearing
// are never overwritten by a later re-ingestion of the same listing.
//
// Product decision (Gate 1 §2/§7, 2026-08-22): a matched cause-list entry
// updates the matter's existing hearing for that date rather than creating
// a second one. Live testing found this duplicating "hearings today" and
// inflating the Morning Brief's own hearing/critical counts for what was
// genuinely one court appearance — an advocate trusts that count every
// morning, so a duplicate is actively misleading, not a cosmetic quirk. A
// matter having two *distinct* real hearings on the same calendar date is
// rare enough (and the existing re-ingestion path already overwrites a
// hearing's source-derived fields outright with no merge) that matching on
// (matter, date) as a fallback is the right default.
async function reconcileHearing(
  supabase: SupabaseClient<Database>,
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
  const versionIds = (priorVersionIds ?? []).map((r) => r.id);

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

export const ingestCauseList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        sourceId: z.string().uuid(),
        listDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        pastedText: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await requireModule(supabase, context.userId, "diary");
    const now = new Date().toISOString();

    // Governance checkpoint, same pattern as the AI Morning Brief layer: a
    // platform admin can turn this off for a chamber from
    // /admin/settings/integrations. This is the real enforcement — the
    // Diary Portal UI hides the import panel when disabled, but a direct
    // call to this function is stopped here regardless.
    const integrations = await getOwnIntegrations(supabase, context.userId);
    const causeListEnabled = integrations.cause_list_enabled ?? true;
    if (!causeListEnabled) {
      throw new Error(
        "Cause List Intelligence is turned off for this chamber by your workspace administrator.",
      );
    }

    const { data: source, error: sourceError } = await supabase
      .from("cause_list_sources")
      .select("*")
      .eq("id", data.sourceId)
      .single();
    if (sourceError) throw new Error(sourceError.message);
    if (!source.enabled) {
      throw new Error("This cause-list source is disabled — enable it before importing a list.");
    }

    const { rows, errors: parseErrors } = parseBulkCauseList(data.pastedText, data.listDate);

    // De-duplicate by source_reference within this one paste — a later
    // occurrence wins, earlier ones are reported rather than silently
    // dropped, since two rows resolving to the same reference usually means
    // the paste contained the same case twice (e.g. listed once, mentioned
    // again in a note).
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
      return {
        sourceId: source.id,
        listDate: data.listDate,
        totalRows: 0,
        newCount: 0,
        changedCount: 0,
        unchangedCount: 0,
        removedCount: 0,
        matchedCount: 0,
        needsReviewCount: 0,
        unmatchedCount: 0,
        parseErrors,
      };
    }

    const [{ data: matters, error: mattersError }, { data: profile }] = await Promise.all([
      supabase.from("matters").select("id, title, case_number, court, opposing_party").limit(500),
      supabase.from("profiles").select("full_name").eq("id", context.userId).maybeSingle(),
    ]);
    if (mattersError) throw new Error(mattersError.message);
    const candidates = (matters ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      caseNumber: m.case_number,
      court: m.court,
      opposingParty: m.opposing_party,
    }));
    const advocateName = profile?.full_name ?? null;

    // Every currently-live listing for this source, not just the ones in
    // this paste — removed-listing detection needs the full set to notice
    // a reference that used to be a head record and now isn't in the batch
    // at all, not just to diff references that are still present.
    const { data: headRecords, error: headError } = await supabase
      .from("cause_list_records")
      .select("*")
      .eq("source_id", source.id)
      .is("superseded_by", null);
    if (headError) throw new Error(headError.message);
    const headByRef = new Map((headRecords ?? []).map((r) => [r.source_reference, r]));

    const headIds = (headRecords ?? []).map((r) => r.id);
    const { data: headMatches } = headIds.length
      ? await supabase.from("cause_list_matches").select("*").in("record_id", headIds)
      : { data: [] as CauseListMatchRow[] };
    const matchByRecordId = new Map((headMatches ?? []).map((m) => [m.record_id, m]));

    // Every already-matched CNR this tenant has ever confirmed (auto tier-1/2
    // or manual), most recent first — this is tier 1 for a CNR the engine
    // has never seen tied to *this* source_reference before (e.g. the case
    // moved to a different bench's list).
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
      if (!priorCnrMap.has(key)) priorCnrMap.set(key, row.matter_id!);
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
        listDate: data.listDate,
        serialNumber: row.serialNumber,
        courtHall: row.courtHall,
        bench: source.bench,
        stage: row.stage,
      };
      const changes = detectChanges(previous ? toComparable(previous) : null, current);
      if (!previous) newCount++;
      else if (changes.some((c) => c.changeType !== "unchanged")) changedCount++;
      else unchangedCount++;

      const { data: newRecord, error: insertError } = await supabase
        .from("cause_list_records")
        .insert({
          source_id: source.id,
          list_date: data.listDate,
          court: source.court,
          bench: source.bench,
          list_type: source.list_type,
          serial_number: row.serialNumber,
          case_number: row.caseNumber,
          cnr: row.cnr,
          petitioner: row.petitioner,
          respondent: row.respondent,
          advocate_names: row.advocateNames,
          stage: row.stage,
          court_hall: row.courtHall,
          source_reference: row.sourceReference,
          raw_payload: row,
          created_by: context.userId,
        })
        .select("*")
        .single();
      if (insertError) throw new Error(insertError.message);

      if (previous) {
        await supabase
          .from("cause_list_records")
          .update({ superseded_by: newRecord.id })
          .eq("id", previous.id);
      }

      if (changes.length > 0) {
        await supabase.from("cause_list_changes").insert(
          changes.map((c) => ({
            record_id: newRecord.id,
            previous_record_id: previous?.id ?? null,
            change_type: c.changeType,
            field_name: c.fieldName,
            old_value: c.oldValue,
            new_value: c.newValue,
          })),
        );
      }

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
        const priorCnrMatterId = row.cnr
          ? (priorCnrMap.get(normalizeCnrKey(row.cnr)) ?? null)
          : null;
        matchResult = matchCauseListRecord(
          recordToMatch,
          candidates,
          priorCnrMatterId,
          advocateName,
        );
      }

      if (matchResult.status === "matched") matchedCount++;
      else if (matchResult.status === "needs_review") needsReviewCount++;
      else unmatchedCount++;

      const carryReview = previousMatch?.status === "matched";
      await supabase.from("cause_list_matches").insert({
        record_id: newRecord.id,
        matter_id: matchResult.matterId,
        match_method: matchResult.method,
        confidence: matchResult.confidence,
        status: matchResult.status,
        reviewed_by: carryReview ? previousMatch!.reviewed_by : null,
        reviewed_at: carryReview ? previousMatch!.reviewed_at : null,
      });

      if (matchResult.status === "matched" && matchResult.matterId) {
        const matter = candidates.find((m) => m.id === matchResult.matterId);
        if (matter) {
          await reconcileHearing(supabase, context.userId, newRecord, matter.id, matter.title);
        }
      }
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

    return {
      sourceId: source.id,
      listDate: data.listDate,
      totalRows: dedupedRows.length,
      newCount,
      changedCount,
      unchangedCount,
      removedCount: removedRefs.length,
      matchedCount,
      needsReviewCount,
      unmatchedCount,
      parseErrors,
    };
  });

// Every currently-live listing (the "head" of each source_reference chain)
// across a date range, joined with its match and — if matched — its
// reconciled hearing. Powers both the Cause List Intelligence table and the
// "My Matters in Today's Cause List" focused view (the client filters this
// same list down to status === "matched").
export const listCauseListEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await requireModule(supabase, context.userId, "diary");

    const { data: records, error: recordsError } = await supabase
      .from("cause_list_records")
      .select(
        "id, source_id, list_date, court, bench, serial_number, case_number, cnr, petitioner, respondent, advocate_names, stage, court_hall, source_reference, created_at",
      )
      .eq("list_date", data.date)
      .is("superseded_by", null)
      .order("serial_number", { ascending: true, nullsFirst: false });
    if (recordsError) throw new Error(recordsError.message);

    const recordIds = (records ?? []).map((r) => r.id);
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
        : Promise.resolve({ data: [] as Database["public"]["Tables"]["hearings"]["Row"][] }),
    ]);

    const matchByRecordId = new Map((matches ?? []).map((m) => [m.record_id, m]));
    // Ascending order means the last write per record_id wins — this is the
    // record's most recent state, which is what distinguishes "changed but
    // still on the list" from "no longer on the list" (a 'removed' entry
    // logged after an earlier 'new_listing'/field-change on the same record
    // when a later ingestion omits it — see findRemovedReferences).
    const latestChangeByRecordId = new Map<string, string>();
    for (const c of changesToday ?? []) latestChangeByRecordId.set(c.record_id, c.change_type);
    const hearingByRecordId = new Map(
      (hearings ?? [])
        .filter((h) => h.cause_list_record_id)
        .map((h) => [h.cause_list_record_id!, h]),
    );

    const matterIds = [
      ...new Set((matches ?? []).map((m) => m.matter_id).filter((id): id is string => !!id)),
    ];
    const { data: matters } = matterIds.length
      ? await supabase.from("matters").select("id, title").in("id", matterIds)
      : { data: [] as { id: string; title: string }[] };
    const matterTitleById = new Map((matters ?? []).map((m) => [m.id, m.title]));

    const dayHearings = (hearings ?? []).filter((h) => h.hearing_date === data.date);
    const clashKeys = new Set<string>();
    const seenTimes = new Map<string, number>();
    for (const h of dayHearings) {
      if (!h.hearing_time) continue;
      const key = `${h.hearing_date}|${h.hearing_time}`;
      seenTimes.set(key, (seenTimes.get(key) ?? 0) + 1);
    }
    for (const [key, count] of seenTimes) if (count > 1) clashKeys.add(key);

    const entries = (records ?? []).map((r) => {
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
        caseNumber: r.case_number,
        cnr: r.cnr,
        petitioner: r.petitioner,
        respondent: r.respondent,
        advocateNames: r.advocate_names,
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

    return { date: data.date, entries, summary };
  });

export const matchMatterManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ matchId: z.string().uuid(), matterId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await requireModule(supabase, context.userId, "diary");
    const { data: match, error: matchError } = await supabase
      .from("cause_list_matches")
      .select("*")
      .eq("id", data.matchId)
      .single();
    if (matchError) throw new Error(matchError.message);

    const { data: matter, error: matterError } = await supabase
      .from("matters")
      .select("id, title")
      .eq("id", data.matterId)
      .single();
    if (matterError) throw new Error(matterError.message);

    const { error: updateError } = await supabase
      .from("cause_list_matches")
      .update({
        matter_id: data.matterId,
        match_method: "manual",
        confidence: 1,
        status: "matched",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", match.id);
    if (updateError) throw new Error(updateError.message);

    const { data: record, error: recordError } = await supabase
      .from("cause_list_records")
      .select("*")
      .eq("id", match.record_id)
      .single();
    if (recordError) throw new Error(recordError.message);

    await reconcileHearing(supabase, context.userId, record, matter.id, matter.title);
    return { ok: true };
  });

export const rejectCauseListMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ matchId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "diary");
    const { error } = await context.supabase
      .from("cause_list_matches")
      .update({
        matter_id: null,
        status: "rejected",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.matchId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// The matter-scoped cause-list history used by the Matter Timeline (K3).
// cause_list_matches.matter_id already exists (K2) — nothing queried by it
// before this. A matter can be matched to more than one record over time
// (each re-ingested version is matched independently, UNIQUE(record_id)),
// so this expands every matched record to its full source/source_reference
// version chain before pulling changes, the same reference-chain shape
// listCauseListChangeHistory already reads — reusing K2's own change log,
// not a second change-detection mechanism.
export const listMatterCauseListHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ matterId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await requireModule(supabase, context.userId, "diary");

    const { data: matches, error: matchesError } = await supabase
      .from("cause_list_matches")
      .select("record_id")
      .eq("matter_id", data.matterId);
    if (matchesError) throw new Error(matchesError.message);
    const matchedRecordIds = (matches ?? []).map((m) => m.record_id);
    if (matchedRecordIds.length === 0) return [];

    const { data: matchedRecords, error: matchedRecordsError } = await supabase
      .from("cause_list_records")
      .select("source_id, source_reference")
      .in("id", matchedRecordIds);
    if (matchedRecordsError) throw new Error(matchedRecordsError.message);

    const chainKeys = [
      ...new Map(
        (matchedRecords ?? []).map((r) => [
          `${r.source_id}:${r.source_reference}`,
          { sourceId: r.source_id, sourceReference: r.source_reference },
        ]),
      ).values(),
    ];

    const chains = await Promise.all(
      chainKeys.map(({ sourceId, sourceReference }) =>
        supabase
          .from("cause_list_records")
          .select("id, list_date, serial_number, court_hall, bench, stage")
          .eq("source_id", sourceId)
          .eq("source_reference", sourceReference),
      ),
    );
    for (const chain of chains) if (chain.error) throw new Error(chain.error.message);

    const chainRecords = chains.flatMap((c) => c.data ?? []);
    const recordById = new Map(chainRecords.map((r) => [r.id, r]));
    const chainRecordIds = chainRecords.map((r) => r.id);
    if (chainRecordIds.length === 0) return [];

    const { data: changes, error: changesError } = await supabase
      .from("cause_list_changes")
      .select("id, record_id, change_type, field_name, old_value, new_value, detected_at")
      .in("record_id", chainRecordIds)
      .neq("change_type", "unchanged")
      .order("detected_at", { ascending: true });
    if (changesError) throw new Error(changesError.message);

    return (changes ?? []).map((c) => {
      const record = recordById.get(c.record_id);
      return {
        id: c.id,
        recordId: c.record_id,
        changeType: c.change_type,
        fieldName: c.field_name,
        oldValue: c.old_value,
        newValue: c.new_value,
        detectedAt: c.detected_at,
        listDate: record?.list_date ?? null,
        serialNumber: record?.serial_number ?? null,
        courtHall: record?.court_hall ?? null,
        bench: record?.bench ?? null,
        stage: record?.stage ?? null,
      };
    });
  });

export const listCauseListChangeHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ sourceId: z.string().uuid(), sourceReference: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await requireModule(supabase, context.userId, "diary");
    const { data: versions, error: versionsError } = await supabase
      .from("cause_list_records")
      .select("id, list_date, created_at")
      .eq("source_id", data.sourceId)
      .eq("source_reference", data.sourceReference)
      .order("created_at", { ascending: true });
    if (versionsError) throw new Error(versionsError.message);

    const versionIds = (versions ?? []).map((v) => v.id);
    if (versionIds.length === 0) return [];

    const { data: changes, error: changesError } = await supabase
      .from("cause_list_changes")
      .select("id, record_id, change_type, field_name, old_value, new_value, detected_at")
      .in("record_id", versionIds)
      .order("detected_at", { ascending: true });
    if (changesError) throw new Error(changesError.message);
    return changes ?? [];
  });
