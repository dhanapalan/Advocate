import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decryptField, encryptField } from "@/lib/field-encryption";
import { requireModule } from "@/lib/require-module";

// Tenant-scoped matters CRUD. RLS (tenant_id = current_tenant_id()) stops
// cross-tenant access; requireModule stops a tenant whose own plan doesn't
// include matters/case-tracking, regardless of tenant. Client CRUD moved to
// clients.functions.ts (20260826 module-selling pivot) — matters and
// clients are now separately-sold modules, not one file.

export const listMatters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireModule(context.supabase, context.userId, "matters");
    const { data, error } = await context.supabase
      .from("matters")
      .select(
        "id, title, client_name, case_number, court, status, opposing_party, filed_date, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// Single-matter fetch for the matter detail page. RLS makes "belongs to
// another tenant" and "doesn't exist" indistinguishable (both resolve to
// null) — that's the correct, non-leaking behavior, not a bug to fix.
export const getMatter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ matterId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "matters");
    const { data: matter, error } = await context.supabase
      .from("matters")
      .select(
        "id, title, client_name, case_number, court, status, opposing_party, filed_date, notes, created_at",
      )
      .eq("id", data.matterId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!matter) return matter;
    return { ...matter, notes: await decryptField(matter.notes) };
  });

// Real omission, not an intentional Phase-1 gap — flagged in the Gate 1 QA
// baseline (docs/gate-1-qa-validation-plan.md) and fixed here. RLS already
// allowed UPDATE for any tenant member and DELETE for tenant admins only
// (20260819101123_tenant_scoped_matters.sql) — this was purely a missing
// server function + UI, not a missing policy.
export const updateMatter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        matterId: z.string().uuid(),
        title: z.string().min(2),
        clientName: z.string().optional(),
        caseNumber: z.string().optional(),
        court: z.string().optional(),
        opposingParty: z.string().optional(),
        filedDate: z.string().optional(),
        status: z.enum(["active", "closed", "archived"]),
        notes: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "matters");
    const { data: saved, error } = await context.supabase
      .from("matters")
      .update({
        title: data.title,
        client_name: data.clientName ?? null,
        case_number: data.caseNumber ?? null,
        court: data.court ?? null,
        opposing_party: data.opposingParty ?? null,
        filed_date: data.filedDate ?? null,
        status: data.status,
        notes: await encryptField(data.notes),
      })
      .eq("id", data.matterId)
      .select(
        "id, title, client_name, case_number, court, status, opposing_party, filed_date, notes, created_at",
      )
      .single();
    if (error) throw new Error(error.message);
    // Already have the plaintext the caller sent — return that rather than
    // decrypting what was just written back.
    return { ...saved, notes: data.notes ?? null };
  });

// DELETE is restricted to tenant admins by RLS (is_tenant_admin()) — a
// member calling this gets a clean "0 rows affected", surfaced below as a
// generic failure rather than a silent no-op, since Supabase doesn't
// distinguish "not found" from "not authorized" here any more than
// getMatter does for reads.
export const deleteMatter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ matterId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "matters");
    const { error, count } = await context.supabase
      .from("matters")
      .delete({ count: "exact" })
      .eq("id", data.matterId);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Matter not found, or you don't have permission to delete it.");
    return { ok: true };
  });

export const createMatter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        title: z.string().min(2),
        clientName: z.string().optional(),
        caseNumber: z.string().optional(),
        court: z.string().optional(),
        opposingParty: z.string().optional(),
        filedDate: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "matters");
    const { data: saved, error } = await context.supabase
      .from("matters")
      .insert({
        title: data.title,
        client_name: data.clientName ?? null,
        case_number: data.caseNumber ?? null,
        court: data.court ?? null,
        opposing_party: data.opposingParty ?? null,
        filed_date: data.filedDate ?? null,
        created_by: context.userId,
      })
      .select(
        "id, title, client_name, case_number, court, status, opposing_party, filed_date, created_at",
      )
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });
