import { supabase } from "@/integrations/supabase/client";

// Client-side entry point for the Documents microservice
// (services/documents/) — Phase 4 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Same
// direct-from-browser trust model as src/lib/clients-service.ts. Owns the
// reviewed-document list/status CRUD only — OCR scanning and AI document
// analysis still go through the ocr-extract/ai-analyze-document Edge
// Functions via src/lib/edge-functions.ts, unchanged.
const DOCUMENTS_SERVICE_URL =
  import.meta.env["VITE_DOCUMENTS_SERVICE_URL"] ||
  "https://lexdiary-documents.dhanapalan-advocate.workers.dev";

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in.");

  return fetch(`${DOCUMENTS_SERVICE_URL}${path}`, {
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

export type DocumentAnalysisRecord = {
  id: string;
  name: string;
  matter_ref: string | null;
  doc_kind: string | null;
  summary: string | null;
  parties: unknown;
  key_dates: unknown;
  tags: unknown;
  risk_notes: string | null;
  status: string;
  created_at: string;
};

export async function listDocumentAnalyses(): Promise<DocumentAnalysisRecord[]> {
  return parseOrThrow<DocumentAnalysisRecord[]>(await authedFetch("/api/v1/documents"));
}

export async function updateDocumentAnalysisStatus(input: {
  id: string;
  status: "pending_review" | "approved" | "rejected";
}): Promise<{ ok: true }> {
  return parseOrThrow<{ ok: true }>(
    await authedFetch(`/api/v1/documents/${input.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: input.status }),
    }),
  );
}
