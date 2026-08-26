import { supabase } from "@/integrations/supabase/client";

// Client-side entry point for the Clients microservice (services/clients/) —
// the Phase 1 pilot extraction of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Deliberately NOT
// a TanStack server function: called straight from the browser with the
// user's own Supabase access token, the same trust model
// src/lib/edge-functions.ts already uses for Edge Functions. This keeps the
// main Worker completely uninvolved in Clients CRUD (no Cloudflare env/
// service-binding plumbing needed — see src/lib/server-handler.ts's "stays
// portable" comment) and matches the plan's "every service also exposes the
// same routes over plain HTTPS" requirement directly, without an extra hop.
const CLIENTS_SERVICE_URL =
  import.meta.env["VITE_CLIENTS_SERVICE_URL"] ||
  "https://lexdiary-clients.dhanapalan-advocate.workers.dev";

export type ClientRecord = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
};

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in.");

  return fetch(`${CLIENTS_SERVICE_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

// Same "read the friendly {error} body" fix edge-functions.ts already
// applies for supabase-js's generic FunctionsHttpError — a plain fetch()
// here needs the identical treatment, or every failure from this service
// shows a generic "Failed to fetch" instead of the real reason.
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

export async function listClients(): Promise<ClientRecord[]> {
  const response = await authedFetch("/api/v1/clients");
  return parseOrThrow<ClientRecord[]>(response);
}

export async function createClient(input: {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}): Promise<ClientRecord> {
  const response = await authedFetch("/api/v1/clients", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return parseOrThrow<ClientRecord>(response);
}

export async function updateClient(input: {
  clientId: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}): Promise<ClientRecord> {
  const { clientId, ...body } = input;
  const response = await authedFetch(`/api/v1/clients/${clientId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return parseOrThrow<ClientRecord>(response);
}

export async function deleteClient(input: { clientId: string }): Promise<{ ok: true }> {
  const response = await authedFetch(`/api/v1/clients/${input.clientId}`, {
    method: "DELETE",
  });
  return parseOrThrow<{ ok: true }>(response);
}
