import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findClashKeys, isClashing } from "@/lib/hearing-conflicts";
import { getOwnIntegrations } from "@/lib/tenant-integrations";
import { todayIsoIST } from "@/lib/date-ist";
import { decryptField } from "@/lib/field-encryption";
import { requireModule, getEnabledModules } from "@/lib/require-module";

// Deterministic aggregation for the Court Morning Brief. Every value here
// comes straight from a real query — nothing is inferred or generated. The
// AI summary layer (ai-morning-brief edge function) is a separate step that
// runs on top of this, never in place of it — see generateMorningBriefSummaries
// in edge-functions.ts.
//
// Two things this app genuinely doesn't track yet, so they are represented
// as `null`/absent rather than a fabricated zero: task/deadline tracking
// (no table exists) and court hall (no column exists on hearings). The UI
// is expected to render "Not available" for these, not hide the gap.

export type BriefMatter = {
  id: string;
  title: string;
  clientName: string | null;
  caseNumber: string | null;
  status: string;
  opposingParty: string | null;
} | null;

export type BriefPreviousHearing = {
  hearingDate: string;
  hearingTime: string | null;
  status: string;
  purpose: string | null;
} | null;

export type BriefDocument = {
  id: string;
  name: string;
  docKind: string | null;
  status: string;
  createdAt: string;
  recentlyAnalyzed: boolean;
};

export type BriefInvoiceAlert = {
  id: string;
  invoiceNumber: string;
  amount: number;
  status: string;
  dueDate: string | null;
  overdue: boolean;
};

export type BriefPriority = "critical" | "attention" | "upcoming" | "informational";

export type BriefCauseListSignal = {
  isNewListing: boolean;
  changeSummary: string[];
};

export type BriefItem = {
  hearingId: string;
  matterTitle: string;
  court: string | null;
  hearingTime: string | null;
  purpose: string | null;
  status: string;
  matter: BriefMatter;
  previousHearing: BriefPreviousHearing;
  documents: BriefDocument[];
  invoiceAlerts: BriefInvoiceAlert[];
  hasConflict: boolean;
  causeList: BriefCauseListSignal | null;
  priority: BriefPriority;
  priorityReasons: string[];
};

const RECENT_DOCUMENT_WINDOW_DAYS = 7;

// Explainable, deterministic — no LLM involved. Each reason is a real,
// checkable fact so an advocate can see exactly why an item was flagged.
function classifyPriority(input: {
  hasConflict: boolean;
  status: string;
  hasDocuments: boolean;
  hasOverdueInvoice: boolean;
  hearingTimeMissing: boolean;
  isNewCauseListListing: boolean;
  causeListChanged: boolean;
}): { priority: BriefPriority; reasons: string[] } {
  const reasons: string[] = [];
  if (input.hasConflict) reasons.push("Clashes with another hearing at the same time today");
  if (input.hasOverdueInvoice) reasons.push("This matter has an overdue invoice");
  if (input.isNewCauseListListing)
    reasons.push("New listing on today's cause list — wasn't on record before");
  if (reasons.length > 0) return { priority: "critical", reasons };

  if (input.causeListChanged) reasons.push("Cause-list details changed since it was last imported");

  if (input.status === "adjourned")
    reasons.push("Last recorded as adjourned — confirm today's listing");
  if (!input.hasDocuments) reasons.push("No documents on record for this matter");
  if (input.hearingTimeMissing) reasons.push("No hearing time on record");
  if (reasons.length > 0) return { priority: "attention", reasons };

  return { priority: "upcoming", reasons: [] };
}

export const getMorningBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ date: z.string().optional() }).parse(data ?? {}))
  .handler(async ({ data, context }) => {
    // Primary-module gate: no hearings without Diary, so no brief either —
    // that part hasn't changed since Phase 0. What's new in Phase 7 is
    // per-section feature-detection below: a tenant missing Matters/
    // Documents/Billing gets that section's data quietly omitted from every
    // item rather than the whole brief erroring or (worse) silently reading
    // tables the tenant hasn't purchased access to.
    await requireModule(context.supabase, context.userId, "diary");
    const enabledModules = await getEnabledModules(context.supabase, context.userId, [
      "matters",
      "documents",
      "billing",
    ]);
    const targetDate = data.date ?? todayIsoIST();

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name")
      .eq("id", context.userId)
      .maybeSingle();
    const advocateName = profile?.full_name ?? null;

    // Governance checkpoint: a platform admin can turn the AI layer off for a
    // specific chamber from /admin/settings/integrations, independent of the
    // deterministic Brief itself (which always works). This is the value the
    // client uses to decide whether to offer "Generate AI prep notes" at
    // all — the real enforcement, which this can't bypass, lives in the
    // ai-morning-brief edge function, which checks the same flag itself
    // before ever calling the AI service layer.
    const integrations = await getOwnIntegrations(context.supabase, context.userId);
    const aiEnabled = integrations.ai_morning_brief_enabled ?? true;
    const causeListEnabled = integrations.cause_list_enabled ?? true;

    const { data: todaysHearingsRaw, error: hearingsError } = await context.supabase
      .from("hearings")
      .select(
        "id, matter_id, matter_title, court, hearing_date, hearing_time, purpose, status, cause_list_record_id",
      )
      .eq("hearing_date", targetDate)
      .order("hearing_time", { ascending: true, nullsFirst: false });
    if (hearingsError) throw new Error(hearingsError.message);

    const hearings = await Promise.all(
      (todaysHearingsRaw ?? []).map(async (h) => ({
        ...h,
        purpose: await decryptField(h.purpose),
      })),
    );
    if (hearings.length === 0) {
      return {
        date: targetDate,
        advocateName,
        aiEnabled,
        causeListEnabled,
        items: [] as BriefItem[],
        conflictCount: 0,
      };
    }

    const matterIds = [
      ...new Set(hearings.map((h) => h.matter_id).filter((id): id is string => !!id)),
    ];
    const matterTitles = [...new Set(hearings.map((h) => h.matter_title))];

    const [mattersByIdRes, mattersByTitleRes, priorHearingsRes, relatedDocsRes, invoicesRes] =
      await Promise.all([
        enabledModules.matters && matterIds.length
          ? context.supabase
              .from("matters")
              .select("id, title, client_name, case_number, status, opposing_party")
              .in("id", matterIds)
          : Promise.resolve({ data: [], error: null }),
        enabledModules.matters
          ? context.supabase
              .from("matters")
              .select("id, title, client_name, case_number, status, opposing_party")
              .in("title", matterTitles)
          : Promise.resolve({ data: [], error: null }),
        // Most recent hearing strictly before today for each of today's matter
        // titles — "previous hearing" is matched by matter_title, since
        // hearings.matter_id isn't populated by the create-hearing flow today
        // (see hearing-conflicts.ts and services/diary/src/hearings.ts) and
        // title is the only reliable join key actually in use. Not gated on
        // any module beyond the primary Diary gate above — it's a hearings
        // read, same table this whole brief already depends on.
        context.supabase
          .from("hearings")
          .select("matter_title, hearing_date, hearing_time, status, purpose")
          .in("matter_title", matterTitles)
          .lt("hearing_date", targetDate)
          .order("hearing_date", { ascending: false })
          .limit(500),
        // Best-effort, exact-string match only — ai_documents.matter_ref is
        // free text, not a foreign key, so a fuzzy match here would risk
        // attaching the wrong matter's documents to this brief. Skipped
        // entirely when Documents isn't purchased — see enabledModules above.
        enabledModules.documents
          ? context.supabase
              .from("ai_documents")
              .select("id, name, doc_kind, status, matter_ref, created_at")
              .in("matter_ref", matterTitles)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        enabledModules.billing && matterIds.length
          ? context.supabase
              .from("invoices")
              .select("id, invoice_number, matter_id, amount, status, due_date")
              .in("matter_id", matterIds)
              .neq("status", "paid")
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (mattersByIdRes.error) throw new Error(mattersByIdRes.error.message);
    if (mattersByTitleRes.error) throw new Error(mattersByTitleRes.error.message);
    if (priorHearingsRes.error) throw new Error(priorHearingsRes.error.message);
    if (relatedDocsRes.error) throw new Error(relatedDocsRes.error.message);
    if (invoicesRes.error) throw new Error(invoicesRes.error.message);

    const matterById = new Map((mattersByIdRes.data ?? []).map((m) => [m.id, m]));
    const matterByTitle = new Map((mattersByTitleRes.data ?? []).map((m) => [m.title, m]));

    // priorHearingsRes is ordered newest-first, so the first row seen per
    // title is the most recent prior hearing for that matter.
    const priorHearings = await Promise.all(
      (priorHearingsRes.data ?? []).map(async (row) => ({
        ...row,
        purpose: await decryptField(row.purpose),
      })),
    );
    const previousByTitle = new Map<string, (typeof priorHearings)[number]>();
    for (const row of priorHearings) {
      if (!previousByTitle.has(row.matter_title)) previousByTitle.set(row.matter_title, row);
    }

    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - RECENT_DOCUMENT_WINDOW_DAYS);
    const docsByTitle = new Map<string, BriefDocument[]>();
    for (const doc of relatedDocsRes.data ?? []) {
      const list = docsByTitle.get(doc.matter_ref!) ?? [];
      list.push({
        id: doc.id,
        name: doc.name,
        docKind: doc.doc_kind,
        status: doc.status,
        createdAt: doc.created_at,
        recentlyAnalyzed: new Date(doc.created_at) >= recentCutoff,
      });
      docsByTitle.set(doc.matter_ref!, list);
    }

    const today = todayIsoIST();
    const invoicesByMatterId = new Map<string, BriefInvoiceAlert[]>();
    for (const inv of invoicesRes.data ?? []) {
      if (!inv.matter_id) continue;
      const list = invoicesByMatterId.get(inv.matter_id) ?? [];
      list.push({
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        amount: inv.amount,
        status: inv.status,
        dueDate: inv.due_date,
        overdue: !!inv.due_date && inv.due_date < today,
      });
      invoicesByMatterId.set(inv.matter_id, list);
    }

    const clashKeys = findClashKeys(hearings);

    // Cause-list-derived signals (K2): hearings reconciled from an imported
    // cause list carry cause_list_record_id, and every non-"unchanged" diff
    // detected for that record is what surfaces here — same deterministic
    // change log the Cause List Intelligence page reads, not a second
    // notion of "changed". Suppressed entirely when the tenant has cause
    // lists turned off, same governance pattern as aiEnabled above.
    const causeListRecordIds = causeListEnabled
      ? hearings.map((h) => h.cause_list_record_id).filter((id): id is string => !!id)
      : [];
    const { data: causeListChangesRaw } = causeListRecordIds.length
      ? await context.supabase
          .from("cause_list_changes")
          .select("record_id, change_type, field_name, old_value, new_value")
          .in("record_id", causeListRecordIds)
          .neq("change_type", "unchanged")
      : {
          data: [] as {
            record_id: string;
            change_type: string;
            field_name: string | null;
            old_value: string | null;
            new_value: string | null;
          }[],
        };
    const causeListChangesByRecordId = new Map<string, BriefCauseListSignal>();
    for (const change of causeListChangesRaw ?? []) {
      const existing = causeListChangesByRecordId.get(change.record_id) ?? {
        isNewListing: false,
        changeSummary: [],
      };
      if (change.change_type === "new_listing") {
        existing.isNewListing = true;
      } else if (change.field_name) {
        existing.changeSummary.push(
          `${change.field_name.replace("_", " ")}: ${change.old_value ?? "—"} → ${change.new_value ?? "—"}`,
        );
      }
      causeListChangesByRecordId.set(change.record_id, existing);
    }

    const items: BriefItem[] = hearings.map((h) => {
      const matterRow =
        (h.matter_id ? matterById.get(h.matter_id) : null) ??
        matterByTitle.get(h.matter_title) ??
        null;
      const previousRow = previousByTitle.get(h.matter_title) ?? null;
      const documents = docsByTitle.get(h.matter_title) ?? [];
      const invoiceAlerts = matterRow ? (invoicesByMatterId.get(matterRow.id) ?? []) : [];
      const hasConflict = isClashing(h, clashKeys);
      const causeList = h.cause_list_record_id
        ? (causeListChangesByRecordId.get(h.cause_list_record_id) ?? null)
        : null;

      const { priority, reasons } = classifyPriority({
        hasConflict,
        status: h.status,
        hasDocuments: documents.length > 0,
        hasOverdueInvoice: invoiceAlerts.some((i) => i.overdue),
        hearingTimeMissing: !h.hearing_time,
        isNewCauseListListing: causeList?.isNewListing ?? false,
        causeListChanged:
          !!causeList && !causeList.isNewListing && causeList.changeSummary.length > 0,
      });

      return {
        hearingId: h.id,
        matterTitle: h.matter_title,
        court: h.court,
        hearingTime: h.hearing_time,
        purpose: h.purpose,
        status: h.status,
        matter: matterRow
          ? {
              id: matterRow.id,
              title: matterRow.title,
              clientName: matterRow.client_name,
              caseNumber: matterRow.case_number,
              status: matterRow.status,
              opposingParty: matterRow.opposing_party,
            }
          : null,
        previousHearing: previousRow
          ? {
              hearingDate: previousRow.hearing_date,
              hearingTime: previousRow.hearing_time,
              status: previousRow.status,
              purpose: previousRow.purpose,
            }
          : null,
        documents,
        invoiceAlerts,
        hasConflict,
        causeList,
        priority,
        priorityReasons: reasons,
      };
    });

    return {
      date: targetDate,
      advocateName,
      aiEnabled,
      causeListEnabled,
      items,
      conflictCount: clashKeys.size,
    };
  });
