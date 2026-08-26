import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getOwnIntegrations } from "@/lib/tenant-integrations";
import { decryptField } from "@/lib/field-encryption";
import { requireModule, getEnabledModules } from "@/lib/require-module";

// MatterContextService (K3) — the single, reusable place that assembles
// everything LexDiary actually knows about one matter, tenant-scoped and
// RLS-enforced like every other server function here. This is deliberately
// the ONLY place K3's timeline and AI summary read from; per-feature ad hoc
// queries would just be a second, divergent way to answer "what does
// LexDiary know about this matter?". Later features (K4 Ask My Case, K5
// Deadline Intelligence, K10 Hearing Preparation) are meant to reuse this
// same service rather than re-aggregating the same tables themselves — see
// the K3 spec's "Matter Context Engine" section. Nothing beyond K3 is
// implemented here.

export type MatterContextMatter = {
  id: string;
  title: string;
  clientName: string | null;
  caseNumber: string | null;
  court: string | null;
  status: string;
  opposingParty: string | null;
  filedDate: string | null;
  notes: string | null;
  createdAt: string;
};

export type MatterContextHearing = {
  id: string;
  hearingDate: string;
  hearingTime: string | null;
  court: string | null;
  purpose: string | null;
  status: string;
  courtHall: string | null;
  bench: string | null;
  causeListRecordId: string | null;
};

export type MatterContextCauseListEvent = {
  id: string;
  recordId: string;
  changeType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
  listDate: string | null;
  serialNumber: string | null;
  courtHall: string | null;
  bench: string | null;
  stage: string | null;
};

export type MatterContextDocument = {
  id: string;
  name: string;
  docKind: string | null;
  status: string;
  summary: string | null;
  createdAt: string;
};

export type MatterContext = {
  matter: MatterContextMatter;
  hearings: MatterContextHearing[];
  causeListEvents: MatterContextCauseListEvent[];
  documents: MatterContextDocument[];
  aiEnabled: boolean;
  askCaseEnabled: boolean;
};

export const getMatterContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ matterId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<MatterContext | null> => {
    const { supabase } = context;
    // Primary-module gate: no matter, no context — unchanged since Phase 0.
    // Phase 7 adds per-section feature-detection below: a tenant missing
    // Diary or Documents gets that section quietly omitted rather than the
    // whole context erroring or reading tables it hasn't purchased access to.
    await requireModule(supabase, context.userId, "matters");
    const enabledModules = await getEnabledModules(supabase, context.userId, [
      "diary",
      "documents",
    ]);

    const { data: matterRow, error: matterError } = await supabase
      .from("matters")
      .select(
        "id, title, client_name, case_number, court, status, opposing_party, filed_date, notes, created_at",
      )
      .eq("id", data.matterId)
      .maybeSingle();
    if (matterError) throw new Error(matterError.message);
    if (!matterRow) return null;

    const hearingColumns =
      "id, matter_id, matter_title, court, hearing_date, hearing_time, purpose, status, court_hall, bench, cause_list_record_id";

    const [hearingsByIdRes, hearingsByTitleRes, matchesRes, documentsRes, integrations] =
      await Promise.all([
        enabledModules.diary
          ? supabase.from("hearings").select(hearingColumns).eq("matter_id", matterRow.id)
          : Promise.resolve({ data: [], error: null }),
        enabledModules.diary
          ? supabase.from("hearings").select(hearingColumns).eq("matter_title", matterRow.title)
          : Promise.resolve({ data: [], error: null }),
        enabledModules.diary
          ? supabase.from("cause_list_matches").select("record_id").eq("matter_id", matterRow.id)
          : Promise.resolve({ data: [], error: null }),
        // Best-effort, exact-string match only — ai_documents.matter_ref is
        // free text, not a foreign key (see morning-brief.functions.ts for the
        // same rationale). A document whose matter_ref doesn't exactly equal
        // this matter's title is never attributed here, by design. Skipped
        // entirely when Documents isn't purchased — see enabledModules above.
        enabledModules.documents
          ? supabase
              .from("ai_documents")
              .select("id, name, doc_kind, status, summary, matter_ref, created_at")
              .eq("matter_ref", matterRow.title)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        getOwnIntegrations(supabase, context.userId),
      ]);
    if (hearingsByIdRes.error) throw new Error(hearingsByIdRes.error.message);
    if (hearingsByTitleRes.error) throw new Error(hearingsByTitleRes.error.message);
    if (matchesRes.error) throw new Error(matchesRes.error.message);
    if (documentsRes.error) throw new Error(documentsRes.error.message);

    const hearingById = new Map(
      [...(hearingsByIdRes.data ?? []), ...(hearingsByTitleRes.data ?? [])].map((h) => [h.id, h]),
    );
    const hearings: MatterContextHearing[] = await Promise.all(
      [...hearingById.values()]
        .sort((a, b) => a.hearing_date.localeCompare(b.hearing_date))
        .map(async (h) => ({
          id: h.id,
          hearingDate: h.hearing_date,
          hearingTime: h.hearing_time,
          court: h.court,
          purpose: await decryptField(h.purpose),
          status: h.status,
          courtHall: h.court_hall,
          bench: h.bench,
          causeListRecordId: h.cause_list_record_id,
        })),
    );

    const matchedRecordIds = (matchesRes.data ?? []).map((m) => m.record_id);
    let causeListEvents: MatterContextCauseListEvent[] = [];
    if (matchedRecordIds.length > 0) {
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

      if (chainRecordIds.length > 0) {
        const { data: changes, error: changesError } = await supabase
          .from("cause_list_changes")
          .select("id, record_id, change_type, field_name, old_value, new_value, detected_at")
          .in("record_id", chainRecordIds)
          .neq("change_type", "unchanged")
          .order("detected_at", { ascending: true });
        if (changesError) throw new Error(changesError.message);

        causeListEvents = (changes ?? []).map((c) => {
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
      }
    }

    const documents: MatterContextDocument[] = (documentsRes.data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      docKind: d.doc_kind,
      status: d.status,
      summary: d.summary,
      createdAt: d.created_at,
    }));

    return {
      matter: {
        id: matterRow.id,
        title: matterRow.title,
        clientName: matterRow.client_name,
        caseNumber: matterRow.case_number,
        court: matterRow.court,
        status: matterRow.status,
        opposingParty: matterRow.opposing_party,
        filedDate: matterRow.filed_date,
        notes: await decryptField(matterRow.notes),
        createdAt: matterRow.created_at,
      },
      hearings,
      causeListEvents,
      documents,
      aiEnabled: integrations.ai_matter_intelligence_enabled ?? true,
      askCaseEnabled: integrations.ai_case_intelligence_enabled ?? true,
    };
  });

// K4 Ask My Case — document full text for retrieval. Kept separate from
// getMatterContext above rather than folded into MatterContextDocument:
// raw_text can be up to 60,000 characters per document (see
// ai-analyze-document/index.ts), and the Matter page's timeline/AI-summary
// consumers of getMatterContext have no use for it — fetching it on every
// matter-page view for every document would be pure waste. Only the Ask My
// Case flow, which genuinely needs to search document text, asks for it.
export const getMatterDocumentTexts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ matterId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "matters");
    const { data: matterRow, error: matterError } = await context.supabase
      .from("matters")
      .select("title")
      .eq("id", data.matterId)
      .maybeSingle();
    if (matterError) throw new Error(matterError.message);
    if (!matterRow) return [];

    const { data: documents, error } = await context.supabase
      .from("ai_documents")
      .select("id, name, doc_kind, raw_text, created_at")
      .eq("matter_ref", matterRow.title)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return Promise.all(
      (documents ?? []).map(async (d) => ({
        id: d.id,
        name: d.name,
        docKind: d.doc_kind,
        rawText: await decryptField(d.raw_text),
        createdAt: d.created_at,
      })),
    );
  });

// K4 Ask My Case — conversations scoped to one matter, unlike the general
// /app/assistant page's listConversations (tenant-wide, no matter filter).
// Same exact-string matter_ref === title convention as everywhere else.
export const listMatterConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ matterId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "matters");
    const { data: matterRow, error: matterError } = await context.supabase
      .from("matters")
      .select("title")
      .eq("id", data.matterId)
      .maybeSingle();
    if (matterError) throw new Error(matterError.message);
    if (!matterRow) return [];

    const { data: conversations, error } = await context.supabase
      .from("ai_conversations")
      .select("id, title, updated_at")
      .eq("matter_ref", matterRow.title)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return conversations ?? [];
  });
