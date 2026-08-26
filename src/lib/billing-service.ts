import { supabase } from "@/integrations/supabase/client";

// Client-side entry point for the Billing microservice
// (services/billing/) — Phase 5 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Same
// direct-from-browser trust model as src/lib/clients-service.ts.
const BILLING_SERVICE_URL =
  import.meta.env["VITE_BILLING_SERVICE_URL"] ||
  "https://lexdiary-billing.dhanapalan-advocate.workers.dev";

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in.");

  return fetch(`${BILLING_SERVICE_URL}${path}`, {
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

export type TimeEntryRecord = {
  id: string;
  matter_title: string;
  entry_date: string;
  task: string;
  hours: number;
  rate: number;
  billed: boolean;
  created_at: string;
};

export async function listTimeEntries(): Promise<TimeEntryRecord[]> {
  return parseOrThrow<TimeEntryRecord[]>(await authedFetch("/api/v1/time-entries"));
}

export async function createTimeEntry(input: {
  matterTitle: string;
  entryDate?: string;
  task: string;
  hours: number;
  rate?: number;
}): Promise<TimeEntryRecord> {
  return parseOrThrow<TimeEntryRecord>(
    await authedFetch("/api/v1/time-entries", { method: "POST", body: JSON.stringify(input) }),
  );
}

export type InvoiceRecord = {
  id: string;
  invoice_number: string;
  client_name: string;
  matter_title: string | null;
  amount: number;
  gst_amount: number;
  status: string;
  due_date: string | null;
  created_at: string;
};

export async function listInvoices(): Promise<InvoiceRecord[]> {
  return parseOrThrow<InvoiceRecord[]>(await authedFetch("/api/v1/invoices"));
}

export async function createInvoice(input: {
  invoiceNumber: string;
  clientName: string;
  matterTitle?: string;
  amount: number;
  gstAmount?: number;
  dueDate?: string;
}): Promise<InvoiceRecord> {
  return parseOrThrow<InvoiceRecord>(
    await authedFetch("/api/v1/invoices", { method: "POST", body: JSON.stringify(input) }),
  );
}

export async function updateInvoiceStatus(input: {
  id: string;
  status: "draft" | "sent" | "paid" | "overdue";
}): Promise<{ ok: true }> {
  return parseOrThrow<{ ok: true }>(
    await authedFetch(`/api/v1/invoices/${input.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: input.status }),
    }),
  );
}
