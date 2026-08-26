import { supabase } from "@/integrations/supabase/client";

// Client-side entry point for the AI Assistant microservice
// (services/assistant/) — Phase 6 of
// C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md. Same
// direct-from-browser trust model as src/lib/clients-service.ts. Owns
// ai_conversations/ai_messages CRUD only — asking a question still goes
// through the ai-assistant/ai-ask-case Edge Functions via
// src/lib/edge-functions.ts, unchanged.
const ASSISTANT_SERVICE_URL =
  import.meta.env["VITE_ASSISTANT_SERVICE_URL"] ||
  "https://lexdiary-assistant.dhanapalan-advocate.workers.dev";

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in.");

  return fetch(`${ASSISTANT_SERVICE_URL}${path}`, {
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

export type ConversationRecord = {
  id: string;
  title: string;
  matter_ref: string | null;
  updated_at: string;
};

export async function listConversations(): Promise<ConversationRecord[]> {
  return parseOrThrow<ConversationRecord[]>(await authedFetch("/api/v1/conversations"));
}

export type MessageRecord = {
  id: string;
  role: string;
  content: string;
  sources: unknown;
  created_at: string;
};

export async function listMessages(input: { conversationId: string }): Promise<MessageRecord[]> {
  return parseOrThrow<MessageRecord[]>(
    await authedFetch(`/api/v1/conversations/${input.conversationId}/messages`),
  );
}

export async function deleteConversation(input: { conversationId: string }): Promise<{ ok: true }> {
  return parseOrThrow<{ ok: true }>(
    await authedFetch(`/api/v1/conversations/${input.conversationId}`, { method: "DELETE" }),
  );
}
