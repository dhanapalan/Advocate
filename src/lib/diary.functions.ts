import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decryptField, encryptField } from "@/lib/field-encryption";

// Tenant-scoped hearings CRUD. Same trust model as matters.functions.ts:
// tenant_id is never accepted from the client, it's DB-derived.

export const listHearings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("hearings")
      .select("id, matter_title, court, hearing_date, hearing_time, purpose, status, created_at")
      .order("hearing_date", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return Promise.all(
      (data ?? []).map(async (h) => ({ ...h, purpose: await decryptField(h.purpose) })),
    );
  });

export const createHearing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        matterTitle: z.string().min(2),
        court: z.string().optional(),
        hearingDate: z.string().min(1),
        hearingTime: z.string().optional(),
        purpose: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: saved, error } = await context.supabase
      .from("hearings")
      .insert({
        matter_title: data.matterTitle,
        court: data.court ?? null,
        hearing_date: data.hearingDate,
        hearing_time: data.hearingTime ?? null,
        purpose: await encryptField(data.purpose),
        created_by: context.userId,
      })
      .select("id, matter_title, court, hearing_date, hearing_time, purpose, status, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { ...saved, purpose: data.purpose ?? null };
  });

// All hearings for one matter, past and future — used by the Matter
// Timeline (K3). Same id-or-title dual-key fallback morning-brief.functions.ts
// already established: matter_id isn't reliably populated by createHearing,
// so results from both keys are unioned and de-duplicated by hearing id
// rather than trusting either key alone.
export const listMatterHearings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ matterId: z.string().uuid(), matterTitle: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const columns =
      "id, matter_id, matter_title, court, hearing_date, hearing_time, purpose, status, court_hall, bench, cause_list_record_id, created_at";
    const [byIdRes, byTitleRes] = await Promise.all([
      context.supabase.from("hearings").select(columns).eq("matter_id", data.matterId),
      context.supabase.from("hearings").select(columns).eq("matter_title", data.matterTitle),
    ]);
    if (byIdRes.error) throw new Error(byIdRes.error.message);
    if (byTitleRes.error) throw new Error(byTitleRes.error.message);

    const byId = new Map(
      [...(byIdRes.data ?? []), ...(byTitleRes.data ?? [])].map((h) => [h.id, h]),
    );
    const merged = [...byId.values()].sort((a, b) => a.hearing_date.localeCompare(b.hearing_date));
    return Promise.all(merged.map(async (h) => ({ ...h, purpose: await decryptField(h.purpose) })));
  });

export const updateHearingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["confirmed", "cause_list_awaited", "adjourned", "completed"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("hearings")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
