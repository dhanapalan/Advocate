import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decryptField, encryptField } from "@/lib/field-encryption";
import { requireModule } from "@/lib/require-module";

// AI-calling functions (askAssistant, analyzeDocument, generateDraft,
// generateBriefing) live in supabase/functions/ as Edge Functions — see
// src/lib/edge-functions.ts. That's where the AI_GATEWAY_API_KEY lives, and
// it keeps AI calls working from any client (web, native) without requiring
// a Node/Nitro server behind it. These remaining functions are plain
// RLS-scoped CRUD with no secrets, so they stay as TanStack server functions.

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireModule(context.supabase, context.userId, "ai_assistant");
    const { data, error } = await context.supabase
      .from("ai_conversations")
      .select("id, title, matter_ref, updated_at")
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ conversationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "ai_assistant");
    // RLS (tenant_id = current_tenant_id()) already scopes this to the
    // caller's firm — a row coming back at all confirms it's in-tenant.
    const { data: visible } = await context.supabase
      .from("ai_conversations")
      .select("id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!visible) throw new Error("Conversation not found");

    const { data: rows, error } = await context.supabase
      .from("ai_messages")
      .select("id, role, content, sources, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ conversationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "ai_assistant");
    const { error } = await context.supabase
      .from("ai_conversations")
      .delete()
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDocumentAnalyses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireModule(context.supabase, context.userId, "documents");
    const { data, error } = await context.supabase
      .from("ai_documents")
      .select(
        "id, name, matter_ref, doc_kind, summary, parties, key_dates, tags, risk_notes, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const REVIEW_STATUS = z.enum(["pending_review", "approved", "rejected"]);

export const updateDocumentAnalysisStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), status: REVIEW_STATUS }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "documents");
    const { error } = await context.supabase
      .from("ai_documents")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireModule(context.supabase, context.userId, "ai_drafting");
    const { data, error } = await context.supabase
      .from("ai_drafts")
      .select("id, doc_type, matter_ref, instructions, content, status, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return Promise.all(
      (data ?? []).map(async (d) => ({ ...d, content: await decryptField(d.content) })),
    );
  });

export const updateDraftStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), status: REVIEW_STATUS }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "ai_drafting");
    const { error } = await context.supabase
      .from("ai_drafts")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), content: z.string() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "ai_drafting");
    const { error } = await context.supabase
      .from("ai_drafts")
      .update({ content: await encryptField(data.content) })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Dictation formatting (dictation-format edge function) doesn't persist —
// it's a stateless text-cleanup call. This saves the result into the same
// ai_drafts table the drafting studio uses, so dictated drafts aren't lost
// and show up alongside AI-generated ones.
export const saveDictatedDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        docType: z.string().min(1),
        matterRef: z.string().optional(),
        content: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireModule(context.supabase, context.userId, "ai_drafting");
    const { data: saved, error } = await context.supabase
      .from("ai_drafts")
      .insert({
        user_id: context.userId,
        doc_type: data.docType,
        matter_ref: data.matterRef ?? null,
        instructions: "(Dictated)",
        content: await encryptField(data.content),
      })
      .select("id, doc_type, matter_ref, instructions, content, status, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { ...saved, content: data.content };
  });
