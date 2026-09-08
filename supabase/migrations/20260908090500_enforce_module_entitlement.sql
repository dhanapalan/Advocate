-- SECURITY FIX (authorization / monetization boundary): the paid-module gate
-- existed only in application code, so it could be routed around entirely.
--
-- requireModule() is implemented ten times over — src/lib/require-module.ts,
-- supabase/functions/_shared/modules.ts, and one copy per extracted Worker in
-- services/*/src/require-module.ts — and every copy reads
-- licenses.integrations ->> '{module}_enabled' in TypeScript. Meanwhile every
-- module-owned table carries a direct grant:
--
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
--
-- and Supabase's PostgREST endpoint is reachable from any browser with the
-- publishable key (public by design) plus the user's own access token. So a
-- chamber that never purchased Billing could simply POST to
-- /rest/v1/invoices and get full CRUD: RLS still confined them to their own
-- tenant, but nothing in the database had ever heard of module entitlements.
-- Extracting seven Workers in phases 1-7 moved that check further from the
-- data rather than closer to it.
--
-- assert_feature() already existed for plan-level features (ocr/whatsapp/team)
-- but is only ever called from Edge Functions, and no trigger invoked it. The
-- correct precedent is enforce_tenant_writable(), which puts subscription
-- lapse in the database and is therefore not bypassable at all. This migration
-- gives module entitlement the same treatment.
--
-- ---------------------------------------------------------------------------
-- Scope: INSERT only, deliberately.
--
-- Blocking INSERT is what actually stops an unpurchased module being used —
-- you cannot add matters, clients, hearings, invoices, time entries, drafts,
-- documents or conversations. UPDATE and DELETE are deliberately NOT gated,
-- for a concrete reason this repo has already been bitten by twice:
--
--   * DELETE: tenants cascades to every one of these tables, and
--     delete_my_account() deletes the licenses row explicitly BEFORE the
--     tenant (20260821120000) — so a gate firing during teardown would look
--     up a licence that no longer exists. See also 20260825130000, where the
--     audit triggers hit exactly this.
--   * UPDATE: matters -> hearings/time_entries/invoices/cause_list_matches is
--     ON DELETE SET NULL, so deleting a matter fires an UPDATE on those child
--     rows. A chamber that had dropped the Billing module could then no longer
--     delete its own matters — punishing a downgrade by breaking an unrelated
--     operation.
--
-- The residual gap is narrow and acceptable: editing rows you created while
-- you *were* entitled stays possible, which is consistent with this codebase's
-- existing "your data stays readable and yours" posture for lapsed trials and
-- cancelled subscriptions. Creating anything new is blocked.
-- ---------------------------------------------------------------------------

-- Single source of truth for "does this chamber have this module", mirroring
-- requireModule()'s semantics exactly: trial unlocks everything (see
-- 20260820020000_trial_unlocks_all_features.sql), otherwise the module is
-- available only once integrations."{module}_enabled" is explicitly true.
--
-- Compared as text rather than cast to boolean on purpose — a malformed value
-- in the JSONB should read as "not enabled", never raise inside a trigger.
--
-- Returns TRUE when the chamber has no licence row at all. That is a
-- deliberate fail-open, matching enforce_tenant_writable(): see the DELETE
-- note above for why a teardown must never be blocked by this lookup.
--
-- The INNER COALESCE is load-bearing and must not be folded into the outer
-- one. `->>` yields NULL when the key is absent, and `false OR NULL` is NULL,
-- not false — so without it a paid licence whose integrations JSON simply has
-- no "{module}_enabled" key (the overwhelmingly common "not purchased" case)
-- returns NULL, the outer COALESCE turns that into TRUE, and the whole gate
-- becomes a no-op for every paid plan. The two COALESCEs answer different
-- questions: the inner one is "key missing = not purchased", the outer one is
-- "licence row missing = do not block". Caught by running the verification
-- against a local instance; reading the SQL did not surface it.
CREATE OR REPLACE FUNCTION public.module_enabled(p_tenant_id UUID, p_module TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT l.plan = 'trial'
         OR COALESCE((l.integrations ->> (p_module || '_enabled')) = 'true', false)
       FROM public.licenses l
      WHERE l.tenant_id = p_tenant_id),
    true);
$$;
REVOKE ALL ON FUNCTION public.module_enabled(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.module_enabled(UUID, TEXT) TO authenticated;
COMMENT ON FUNCTION public.module_enabled(UUID, TEXT) IS
  'Is a sellable module available to this chamber? Trial unlocks everything; otherwise licenses.integrations."{module}_enabled" must be true. Returns true when no licence row exists (fail-open, so account teardown is never blocked). Keep in sync with requireModule() in src/lib/require-module.ts, supabase/functions/_shared/modules.ts and services/*/src/require-module.ts.';

-- Same wording the ten TypeScript copies produce, so a user sees one message
-- whether they were stopped by the Worker or by the database underneath it.
CREATE OR REPLACE FUNCTION public.module_denied_message(p_module TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_module
    WHEN 'matters'             THEN 'Case/matter tracking'
    WHEN 'clients'             THEN 'Client management'
    WHEN 'diary'               THEN 'The court diary'
    WHEN 'documents'           THEN 'Document intake (including OCR)'
    WHEN 'billing'             THEN 'Time tracking and billing'
    WHEN 'ai_drafting'         THEN 'AI drafting (including dictation)'
    WHEN 'ai_assistant'        THEN 'The AI case assistant'
    WHEN 'matter_intelligence' THEN 'AI matter intelligence'
    ELSE p_module
  END || ' isn''t included on this chamber''s plan yet — contact chambers@lexdiary.online to add it.';
$$;
REVOKE ALL ON FUNCTION public.module_denied_message(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.module_denied_message(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_module_entitlement() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  module_key TEXT := TG_ARGV[0];
  target_tenant UUID;
BEGIN
  -- COALESCE rather than NEW.tenant_id alone: on ai_conversations/ai_messages/
  -- ai_documents/ai_drafts the tenant is populated by the *_set_tenant BEFORE
  -- INSERT triggers, and Postgres fires BEFORE triggers in alphabetical order
  -- by trigger name — so this must not depend on having run after them.
  target_tenant := COALESCE(NEW.tenant_id, public.current_tenant_id());

  -- No resolvable tenant means either a service-role write (trusted: the
  -- digest cron, migrations) or a row RLS is about to reject anyway.
  IF target_tenant IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.module_enabled(target_tenant, module_key) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '%', public.module_denied_message(module_key) USING ERRCODE = '42501';
END; $$;
REVOKE ALL ON FUNCTION public.enforce_module_entitlement() FROM PUBLIC, anon, authenticated;

-- Table -> module key. Mirrors the "Owns" column of the microservices table in
-- docs/microservices-decomposition-status.md.
--
-- ai_conversations/ai_messages are gated on ai_assistant even though K4 (Ask
-- My Case) reaches them from a matter_intelligence flow — that preserves the
-- behaviour services/assistant/ already has, rather than introducing a new
-- cross-module dependency here. matter_intelligence itself owns no table.
DO $$
DECLARE
  entry TEXT[];
BEGIN
  FOREACH entry SLICE 1 IN ARRAY ARRAY[
    ARRAY['matters',            'matters'],
    ARRAY['clients',            'clients'],
    ARRAY['hearings',           'diary'],
    ARRAY['cause_list_sources', 'diary'],
    ARRAY['cause_list_records', 'diary'],
    ARRAY['cause_list_matches', 'diary'],
    ARRAY['cause_list_changes', 'diary'],
    ARRAY['ai_documents',       'documents'],
    ARRAY['time_entries',       'billing'],
    ARRAY['invoices',           'billing'],
    ARRAY['ai_drafts',          'ai_drafting'],
    ARRAY['ai_conversations',   'ai_assistant'],
    ARRAY['ai_messages',        'ai_assistant']
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      entry[1] || '_module_check', entry[1]
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.enforce_module_entitlement(%L)',
      entry[1] || '_module_check', entry[1], entry[2]
    );
  END LOOP;
END $$;
