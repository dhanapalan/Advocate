import type { SupabaseClient } from "@supabase/supabase-js";
import { handleOptions, jsonResponse, errorResponse } from "./cors";
import { authedClient, requireUserId } from "./auth";
import { requireBillingModule } from "./require-module";

// LexDiary Billing service — Phase 5 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Owns
// time_entries and invoices. No FIELD_ENCRYPTION_KEY — neither table has an
// encrypted free-text column (see wrangler.toml's comment). Manually-tracked
// invoice status only, no payment gateway integration — same as the
// original billing.functions.ts.

const TIME_ENTRY_COLUMNS = "id, matter_title, entry_date, task, hours, rate, billed, created_at";
const INVOICE_COLUMNS =
  "id, invoice_number, client_name, matter_title, amount, gst_amount, status, due_date, created_at";

const VALID_INVOICE_STATUSES = new Set(["draft", "sent", "paid", "overdue"]);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function listTimeEntries(req: Request, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("time_entries")
    .select(TIME_ENTRY_COLUMNS)
    .order("entry_date", { ascending: false })
    .limit(200);
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, data ?? []);
}

async function createTimeEntry(req: Request, supabase: SupabaseClient, userId: string) {
  let body: {
    matterTitle?: string;
    entryDate?: string;
    task?: string;
    hours?: number;
    rate?: number;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.matterTitle || body.matterTitle.trim().length < 2) {
    return errorResponse(req, "matterTitle must be at least 2 characters");
  }
  if (!body.task || body.task.trim().length < 2) {
    return errorResponse(req, "task must be at least 2 characters");
  }
  if (typeof body.hours !== "number" || !(body.hours > 0)) {
    return errorResponse(req, "hours must be a positive number");
  }
  if (body.rate !== undefined && (typeof body.rate !== "number" || body.rate < 0)) {
    return errorResponse(req, "rate must be a non-negative number");
  }

  const { data: saved, error } = await supabase
    .from("time_entries")
    .insert({
      matter_title: body.matterTitle,
      ...(body.entryDate ? { entry_date: body.entryDate } : {}),
      task: body.task,
      hours: body.hours,
      rate: body.rate ?? 0,
      created_by: userId,
    })
    .select(TIME_ENTRY_COLUMNS)
    .single();
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, saved);
}

async function listInvoices(req: Request, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, data ?? []);
}

async function createInvoice(req: Request, supabase: SupabaseClient, userId: string) {
  let body: {
    invoiceNumber?: string;
    clientName?: string;
    matterTitle?: string;
    amount?: number;
    gstAmount?: number;
    dueDate?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.invoiceNumber || body.invoiceNumber.trim().length < 1) {
    return errorResponse(req, "invoiceNumber is required");
  }
  if (!body.clientName || body.clientName.trim().length < 2) {
    return errorResponse(req, "clientName must be at least 2 characters");
  }
  if (typeof body.amount !== "number" || body.amount < 0) {
    return errorResponse(req, "amount must be a non-negative number");
  }
  if (body.gstAmount !== undefined && (typeof body.gstAmount !== "number" || body.gstAmount < 0)) {
    return errorResponse(req, "gstAmount must be a non-negative number");
  }

  const { data: saved, error } = await supabase
    .from("invoices")
    .insert({
      invoice_number: body.invoiceNumber,
      client_name: body.clientName,
      matter_title: body.matterTitle ?? null,
      amount: body.amount,
      gst_amount: body.gstAmount ?? 0,
      due_date: body.dueDate ?? null,
      created_by: userId,
    })
    .select(INVOICE_COLUMNS)
    .single();
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, saved);
}

async function updateInvoiceStatus(req: Request, supabase: SupabaseClient, invoiceId: string) {
  if (!isUuid(invoiceId)) return errorResponse(req, "Invalid invoice id", 400);
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, "Invalid JSON body");
  }
  if (!body.status || !VALID_INVOICE_STATUSES.has(body.status)) {
    return errorResponse(req, "status must be one of draft, sent, paid, overdue");
  }

  const { error } = await supabase
    .from("invoices")
    .update({ status: body.status })
    .eq("id", invoiceId);
  if (error) return errorResponse(req, error.message, 400);
  return jsonResponse(req, { ok: true });
}

export default {
  async fetch(req: Request): Promise<Response> {
    const preflight = handleOptions(req);
    if (preflight) return preflight;

    const auth = authedClient(req);
    if (!auth) return errorResponse(req, "Unauthorized", 401);
    const userId = await requireUserId(auth.supabase);
    if (!userId) return errorResponse(req, "Unauthorized", 401);

    try {
      await requireBillingModule(auth.supabase, userId);
    } catch (cause) {
      return errorResponse(
        req,
        cause instanceof Error ? cause.message : "Module check failed.",
        403,
      );
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const { supabase } = auth;

    if (req.method === "GET" && path === "/api/v1/time-entries") {
      return listTimeEntries(req, supabase);
    }
    if (req.method === "POST" && path === "/api/v1/time-entries") {
      return createTimeEntry(req, supabase, userId);
    }

    if (req.method === "GET" && path === "/api/v1/invoices") {
      return listInvoices(req, supabase);
    }
    if (req.method === "POST" && path === "/api/v1/invoices") {
      return createInvoice(req, supabase, userId);
    }
    const invoiceStatusMatch = path.match(/^\/api\/v1\/invoices\/([0-9a-fA-F-]+)\/status$/);
    if (req.method === "PATCH" && invoiceStatusMatch) {
      return updateInvoiceStatus(req, supabase, invoiceStatusMatch[1]!);
    }

    return errorResponse(req, "Not found", 404);
  },
};
