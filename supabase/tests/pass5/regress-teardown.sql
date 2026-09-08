-- Regression: the module trigger must NOT break the two teardown paths the
-- migration header claims it avoids — cascade DELETE and ON DELETE SET NULL —
-- for a chamber that has since dropped the relevant modules.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  uid  UUID := '00000000-0000-4000-8000-0000000000b2';
  t_id UUID;
  m_id UUID;
  h_id UUID;
  i_id UUID;
  te_id UUID;
  res JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'pass5-regress@example.com', 'x', now(), '{}'::jsonb,
          '{"full_name":"Pass5 Regress","firm_name":"Pass5 Regress Chambers"}'::jsonb,
          now(), now());
  SELECT tenant_id INTO t_id FROM public.profiles WHERE id = uid;

  -- Build real content while still on trial (every module unlocked).
  INSERT INTO public.matters (tenant_id, title, created_by)
    VALUES (t_id, 'Regression matter', uid) RETURNING id INTO m_id;
  INSERT INTO public.hearings (tenant_id, matter_id, matter_title, hearing_date, created_by)
    VALUES (t_id, m_id, 'Regression matter', current_date, uid) RETURNING id INTO h_id;
  INSERT INTO public.invoices (tenant_id, matter_id, client_name, invoice_number, amount, created_by)
    VALUES (t_id, m_id, 'Regress Client', 'INV-REGRESS-1', 1000, uid) RETURNING id INTO i_id;
  INSERT INTO public.time_entries (tenant_id, matter_id, matter_title, task, hours, created_by)
    VALUES (t_id, m_id, 'Regression matter', 'Drafting', 0.5, uid) RETURNING id INTO te_id;
  RAISE NOTICE 'fixture built: matter/hearing/invoice/time_entry all created on trial';

  -- Now downgrade: paid plan, NOTHING purchased. Every module is off.
  UPDATE public.licenses
     SET plan = 'solo_basic', status = 'active', integrations = '{}'::jsonb
   WHERE tenant_id = t_id;
  IF public.module_enabled(t_id, 'billing') OR public.module_enabled(t_id, 'diary') THEN
    RAISE EXCEPTION 'FAIL: modules should all be off for this fixture';
  END IF;

  -- (1) Deleting the matter fires ON DELETE SET NULL updates on hearings,
  --     invoices and time_entries — tables whose modules are NOT purchased.
  --     This must still succeed.
  DELETE FROM public.matters WHERE id = m_id;
  IF EXISTS (SELECT 1 FROM public.matters WHERE id = m_id) THEN
    RAISE EXCEPTION 'FAIL: matter was not deleted';
  END IF;
  IF (SELECT matter_id FROM public.invoices WHERE id = i_id) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: invoice.matter_id was not nulled';
  END IF;
  RAISE NOTICE 'PASS R1  matter delete succeeds with every module off (SET NULL cascade intact)';

  -- (2) Full account teardown: delete_my_account() removes licenses first, then
  --     tenants, cascading into all 13 gated tables with no licence row left to
  --     look up. This is the path the fail-open exists for.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid::text)::text, true);
  SELECT public.delete_my_account() INTO res;
  RAISE NOTICE 'PASS R2  delete_my_account() -> %', res;

  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = t_id) THEN
    RAISE EXCEPTION 'FAIL: tenant survived deletion';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hearings WHERE tenant_id = t_id)
     OR EXISTS (SELECT 1 FROM public.invoices WHERE tenant_id = t_id)
     OR EXISTS (SELECT 1 FROM public.time_entries WHERE tenant_id = t_id) THEN
    RAISE EXCEPTION 'FAIL: gated child rows survived the cascade';
  END IF;
  RAISE NOTICE 'PASS R3  chamber and every gated child row removed, zero leftovers';
END $$;

ROLLBACK;
