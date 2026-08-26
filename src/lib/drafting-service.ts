import { supabase } from "@/integrations/supabase/client";

// Client-side entry point for the Drafting microservice (incl. Dictation)
// (services/drafting/) — Phase 6 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Same
// direct-from-browser trust model as src/lib/clients-service.ts. Owns the
// ai_drafts CRUD only — actual draft generation and dictation
// transcription/formatting still go through the ai-generate-draft/
// dictation-transcribe/dictation-format Edge Functions via
// src/lib/edge-functions.ts, unchanged.
const DRAFTING_SERVICE_URL =
  import.meta.env["VITE_DRAFTING_SERVICE_URL"] ||
  "https://lexdiary-drafting.dhanapalan-advocate.workers.dev";

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in.");

  return fetch(`${DRAFTING_SERVICE_URL}${path}`, {
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

export type DraftRecord = {
  id: string;
  doc_type: string;
  matter_ref: string | null;
  instructions: string;
  content: string;
  status: string;
  created_at: string;
};

export async function listDrafts(): Promise<DraftRecord[]> {
  return parseOrThrow<DraftRecord[]>(await authedFetch("/api/v1/drafts"));
}

export async function updateDraftStatus(input: {
  id: string;
  status: "pending_review" | "approved" | "rejected";
}): Promise<{ ok: true }> {
  return parseOrThrow<{ ok: true }>(
    await authedFetch(`/api/v1/drafts/${input.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: input.status }),
    }),
  );
}

export async function saveDraft(input: { id: string; content: string }): Promise<{ ok: true }> {
  return parseOrThrow<{ ok: true }>(
    await authedFetch(`/api/v1/drafts/${input.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: input.content }),
    }),
  );
}

export async function saveDictatedDraft(input: {
  docType: string;
  matterRef?: string;
  content: string;
}): Promise<DraftRecord> {
  return parseOrThrow<DraftRecord>(
    await authedFetch("/api/v1/drafts/dictated", { method: "POST", body: JSON.stringify(input) }),
  );
}
