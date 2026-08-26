import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireModule } from "@/lib/require-module";

// Tenant-scoped time-entry and invoice CRUD. Manually-tracked invoice
// status only — no payment gateway integration (see the
// hearings_time_billing migration for why). tenant_id is never accepted
// from the client.

export const listTimeEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireModule(context.supabase, context.userId, "billing");
    const { data, error } = await context.supabase
      .from("time_entries")
      .select("id, matter_title, entry_date, task, hours, rate, billed, created_at")
      .order("entry_date", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        matterTitle: z.string().min(2),
        entryDate: z.string().optional(),
        task: z.string().min(2),
        hours: z.number().positive(),
        rate: z.number().nonnegative().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "billing");
    const { data: saved, error } = await context.supabase
      .from("time_entries")
      .insert({
        matter_title: data.matterTitle,
        ...(data.entryDate ? { entry_date: data.entryDate } : {}),
        task: data.task,
        hours: data.hours,
        rate: data.rate ?? 0,
        created_by: context.userId,
      })
      .select("id, matter_title, entry_date, task, hours, rate, billed, created_at")
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireModule(context.supabase, context.userId, "billing");
    const { data, error } = await context.supabase
      .from("invoices")
      .select(
        "id, invoice_number, client_name, matter_title, amount, gst_amount, status, due_date, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        invoiceNumber: z.string().min(1),
        clientName: z.string().min(2),
        matterTitle: z.string().optional(),
        amount: z.number().nonnegative(),
        gstAmount: z.number().nonnegative().optional(),
        dueDate: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "billing");
    const { data: saved, error } = await context.supabase
      .from("invoices")
      .insert({
        invoice_number: data.invoiceNumber,
        client_name: data.clientName,
        matter_title: data.matterTitle ?? null,
        amount: data.amount,
        gst_amount: data.gstAmount ?? 0,
        due_date: data.dueDate ?? null,
        created_by: context.userId,
      })
      .select(
        "id, invoice_number, client_name, matter_title, amount, gst_amount, status, due_date, created_at",
      )
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const updateInvoiceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ id: z.string().uuid(), status: z.enum(["draft", "sent", "paid", "overdue"]) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "billing");
    const { error } = await context.supabase
      .from("invoices")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
