import { supabase } from "@/integrations/supabase/client";

// Client-side entry point for the Matters microservice (services/matters/)
// — Phase 2 of C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md.
// Same direct-from-browser trust model as src/lib/clients-service.ts (see
// its header comment for why). getMatter was intentionally not ported —
// nothing in the app called matters.functions.ts's old getMatter export
// (the matter detail page reads via getMatterContext instead), so there's
// nothing here to replace it.
const MATTERS_SERVICE_URL =
  import.meta.env["VITE_MATTERS_SERVICE_URL"] ||
  "https://lexdiary-matters.dhanapalan-advocate.workers.dev";

export type MatterRecord = {
  id: string;
  title: string;
  client_name: string | null;
  case_number: string | null;
  court: string | null;
  status: string;
  opposing_party: string | null;
  filed_date: string | null;
  created_at: string;
};

export type MatterWriteRecord = MatterRecord & { notes: string | null };

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in.");

  return fetch(`${MATTERS_SERVICE_URL}${path}`, {
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

export async function listMatters(): Promise<MatterRecord[]> {
  const response = await authedFetch("/api/v1/matters");
  return parseOrThrow<MatterRecord[]>(response);
}

export async function createMatter(input: {
  title: string;
  clientName?: string;
  caseNumber?: string;
  court?: string;
  opposingParty?: string;
  filedDate?: string;
}): Promise<MatterRecord> {
  const response = await authedFetch("/api/v1/matters", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return parseOrThrow<MatterRecord>(response);
}

export async function updateMatter(input: {
  matterId: string;
  title: string;
  clientName?: string;
  caseNumber?: string;
  court?: string;
  opposingParty?: string;
  filedDate?: string;
  status: "active" | "closed" | "archived";
  notes?: string;
}): Promise<MatterWriteRecord> {
  const { matterId, ...body } = input;
  const response = await authedFetch(`/api/v1/matters/${matterId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return parseOrThrow<MatterWriteRecord>(response);
}

export async function deleteMatter(input: { matterId: string }): Promise<{ ok: true }> {
  const response = await authedFetch(`/api/v1/matters/${input.matterId}`, {
    method: "DELETE",
  });
  return parseOrThrow<{ ok: true }>(response);
}
