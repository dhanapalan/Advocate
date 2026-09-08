-- PRIVACY FIX: AI conversations, messages and drafts were readable by every
-- member of the chamber, while editing and deleting them were already
-- restricted to the author or a chamber admin.
--
-- That asymmetry is the tell. From 20260819101123_tenant_scoped_matters.sql
-- onward each of these tables carries a pair like:
--
--   SELECT  USING (tenant_id = public.current_tenant_id())          -- everyone
--   DELETE  USING (user_id = auth.uid() OR is_tenant_admin(...))    -- author/admin
--
-- If a draft is private enough that a colleague may not delete it, a junior
-- member should not be able to read the senior partner's assistant chats and
-- unfinished drafts either. Nothing in the product surfaces these as shared
-- chamber content — the Assistant and Drafting screens both present them as
-- "your" conversations and "your" drafts.
--
-- SELECT is therefore narrowed to match the DELETE policy each table already
-- had: the author sees their own, and chamber owners/admins still see
-- everything (they can already delete it, and they need that for oversight and
-- for a departing member's work).
--
-- Tenant isolation is unaffected — is_tenant_admin() is tenant-scoped and
-- auth.uid() is per-user, so this can only ever narrow what was visible, never
-- widen it across chambers.
--
-- Known behaviour changes, all intended:
--   * getMatterContext()'s "previous conversations about this matter" list
--     (src/lib/matter-context.functions.ts) now shows only the caller's own.
--   * listDrafts / listConversations in services/drafting/ and
--     services/assistant/ now return only the caller's own, unless they are a
--     chamber owner/admin.

DROP POLICY IF EXISTS "Tenant members view conversations" ON public.ai_conversations;
CREATE POLICY "Creator or admin view conversations" ON public.ai_conversations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Tenant members view messages" ON public.ai_messages;
CREATE POLICY "Creator or admin view messages" ON public.ai_messages
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Tenant members view drafts" ON public.ai_drafts;
CREATE POLICY "Creator or admin view drafts" ON public.ai_drafts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_tenant_admin(tenant_id));

-- ai_documents is deliberately left chamber-wide. Unlike the three above it is
-- genuinely shared work product: a scanned document goes through an
-- Approve/Reject review workflow (20260822110000) that any member can action,
-- and getMatterContext() feeds its extracted text to Ask My Case as matter
-- context for the whole chamber. Narrowing it would break both.
