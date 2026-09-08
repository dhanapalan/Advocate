-- Pass 5 fix verification. Run against the LOCAL supabase instance only.
-- Everything happens inside one transaction that is rolled back at the end,
-- so it leaves no rows behind.
\set ON_ERROR_STOP on
BEGIN;

-- ===========================================================================
-- P5-1: log_auth_event must no longer be reachable by anon/authenticated
-- ===========================================================================
DO $$
DECLARE
  sig TEXT := 'public.log_auth_event(uuid,text,text,text,text,text)';
BEGIN
  IF has_function_privilege('anon', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL P5-1: anon can still EXECUTE log_auth_event';
  END IF;
  IF has_function_privilege('authenticated', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL P5-1: authenticated can still EXECUTE log_auth_event';
  END IF;
  IF NOT has_function_privilege('service_role', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL P5-1: service_role LOST EXECUTE - the edge function would break';
  END IF;
  RAISE NOTICE 'PASS P5-1  log_auth_event: anon=no authenticated=no service_role=yes';
END $$;

-- ===========================================================================
-- P5-2: module entitlement enforced in the database
-- ===========================================================================
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n
    FROM pg_trigger
   WHERE NOT tgisinternal AND tgname LIKE '%\_module\_check';
  IF n <> 13 THEN
    RAISE EXCEPTION 'FAIL P5-2: expected 13 module_check triggers, found %', n;
  END IF;
  RAISE NOTICE 'PASS P5-2a module_check trigger present on all 13 module-owned tables';
END $$;

DO $$
DECLARE
  uid   UUID := '00000000-0000-4000-8000-0000000000a1';
  t_id  UUID;
  blocked BOOLEAN := false;
  new_matter UUID;
BEGIN
  -- A real auth user; handle_new_user() builds the chamber, licence and profile.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'pass5-verify@example.com', 'x', now(), '{}'::jsonb,
          '{"full_name":"Pass5 Verify","firm_name":"Pass5 Chambers"}'::jsonb, now(), now());

  SELECT tenant_id INTO t_id FROM public.profiles WHERE id = uid;
  IF t_id IS NULL THEN RAISE EXCEPTION 'FAIL P5-2: fixture tenant was not created'; END IF;

  -- (a) trial unlocks everything
  IF NOT public.module_enabled(t_id, 'matters') THEN
    RAISE EXCEPTION 'FAIL P5-2b: trial licence should unlock every module';
  END IF;
  RAISE NOTICE 'PASS P5-2b module_enabled(trial, matters) = true';

  -- (b) paid plan with no module flags set -> denied
  UPDATE public.licenses
     SET plan = 'solo_pro', status = 'active', integrations = '{}'::jsonb
   WHERE tenant_id = t_id;
  IF public.module_enabled(t_id, 'matters') THEN
    RAISE EXCEPTION 'FAIL P5-2c: paid plan with no flag should NOT have matters';
  END IF;
  RAISE NOTICE 'PASS P5-2c module_enabled(paid, no flag) = false';

  -- (c) the trigger actually refuses the INSERT (this is the bypass being closed)
  BEGIN
    INSERT INTO public.matters (tenant_id, title, created_by)
    VALUES (t_id, 'should be refused', uid);
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'FAIL P5-2d: direct INSERT into matters was NOT blocked';
  END IF;
  RAISE NOTICE 'PASS P5-2d direct INSERT into matters refused (42501) for an unpurchased module';

  -- (d) turning the module on lets the same INSERT through
  UPDATE public.licenses
     SET integrations = '{"matters_enabled": true}'::jsonb
   WHERE tenant_id = t_id;
  INSERT INTO public.matters (tenant_id, title, created_by)
  VALUES (t_id, 'should be allowed', uid)
  RETURNING id INTO new_matter;
  IF new_matter IS NULL THEN
    RAISE EXCEPTION 'FAIL P5-2e: INSERT failed even with the module enabled';
  END IF;
  RAISE NOTICE 'PASS P5-2e same INSERT succeeds once matters_enabled = true';

  -- (e) the fail-open path: no licence row must never block (account teardown)
  DELETE FROM public.licenses WHERE tenant_id = t_id;
  IF NOT public.module_enabled(t_id, 'billing') THEN
    RAISE EXCEPTION 'FAIL P5-2f: module_enabled must fail OPEN with no licence row';
  END IF;
  INSERT INTO public.matters (tenant_id, title, created_by)
  VALUES (t_id, 'teardown-safe', uid);
  RAISE NOTICE 'PASS P5-2f no licence row = fail open (delete_my_account teardown stays safe)';
END $$;

-- ===========================================================================
-- P5-7: a spent invite stops disclosing who was invited to which chamber
-- ===========================================================================
DO $$
DECLARE
  uid  UUID := '00000000-0000-4000-8000-0000000000a1';
  t_id UUID;
  tok  UUID := gen_random_uuid();
  r    RECORD;
BEGIN
  SELECT tenant_id INTO t_id FROM public.profiles WHERE id = uid;

  INSERT INTO public.tenant_invites (tenant_id, email, role, invited_by, token, status, expires_at)
  VALUES (t_id, 'invitee@example.com', 'member', uid, tok, 'pending', now() + interval '7 days');

  SELECT * INTO r FROM public.get_invite_info(tok);
  IF NOT r.valid OR r.email IS NULL OR r.tenant_name IS NULL THEN
    RAISE EXCEPTION 'FAIL P5-7a: a pending invite should still return its details';
  END IF;
  RAISE NOTICE 'PASS P5-7a pending invite still returns tenant_name/email/role';

  UPDATE public.tenant_invites SET status = 'accepted', accepted_at = now() WHERE token = tok;
  SELECT * INTO r FROM public.get_invite_info(tok);
  IF r.valid THEN RAISE EXCEPTION 'FAIL P5-7b: accepted invite still reports valid'; END IF;
  IF r.email IS NOT NULL OR r.tenant_name IS NOT NULL OR r.role IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL P5-7b: accepted invite still discloses % / %', r.tenant_name, r.email;
  END IF;
  RAISE NOTICE 'PASS P5-7b spent invite returns valid=false with every other column NULL';
END $$;

-- ===========================================================================
-- P5-10: AI content narrowed to creator-or-admin
-- ===========================================================================
DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(tablename || ':' || policyname, ', ')
    INTO bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND cmd = 'SELECT'
     AND tablename IN ('ai_conversations', 'ai_messages', 'ai_drafts')
     AND qual NOT LIKE '%uid()%';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL P5-10: chamber-wide SELECT policy still present -> %', bad;
  END IF;
  RAISE NOTICE 'PASS P5-10 ai_conversations/ai_messages/ai_drafts SELECT is creator-or-admin';

  -- ai_documents must stay chamber-wide (shared review workflow + Ask My Case)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ai_documents'
       AND cmd = 'SELECT' AND qual LIKE '%current_tenant_id()%'
  ) THEN
    RAISE EXCEPTION 'FAIL P5-10: ai_documents lost its chamber-wide SELECT policy';
  END IF;
  RAISE NOTICE 'PASS P5-10 ai_documents deliberately still chamber-wide';
END $$;

ROLLBACK;
