----------------------------------------------------------- pricing update
-- Repricing pass, 2026-08-25. Old prices (Solo Basic Rs 499, Solo Pro Rs 799,
-- Chamber Rs 999/2 seats, extra seat Rs 499) were set before unit economics
-- (AI cost, infra, R&D/deployment headcount, sales & support) were modeled —
-- see the pricing calculator worked through with the user. At realistic AI
-- utilization, the old Chamber price was already running at negative margin
-- once real infra + team costs were included. New prices:
--   Solo Basic  Rs 2999 / month
--   Solo Pro    Rs 3999 / month
--   Chamber     Rs 7999 / month   2 seats included, extra seat Rs 1999/month
-- No other plan behavior changes (limits, features, seat floor logic).
CREATE OR REPLACE FUNCTION public.plan_price_inr(p_plan TEXT, p_component TEXT DEFAULT 'base')
RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_component
    WHEN 'base' THEN
      CASE p_plan WHEN 'trial' THEN 0 WHEN 'solo_basic' THEN 2999 WHEN 'solo_pro' THEN 3999 WHEN 'chamber' THEN 7999 ELSE 0 END
    WHEN 'extra_seat' THEN
      CASE p_plan WHEN 'chamber' THEN 1999 ELSE NULL END
    ELSE NULL
  END;
$$;
COMMENT ON FUNCTION public.plan_price_inr IS 'Monthly rupee price. component: base | extra_seat. NULL extra_seat means the plan cannot add seats. Repriced 2026-08-25.';

-- Same logic as the original (20260820010000_pricing_plans_and_firm_features.sql)
-- — only the Rs amounts named in the two error messages change, to match the
-- prices above.
CREATE OR REPLACE FUNCTION public.enforce_seat_limit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lic_plan TEXT;
  seat_cap INTEGER;
  used INTEGER;
BEGIN
  SELECT plan, seats INTO lic_plan, seat_cap FROM public.licenses WHERE tenant_id = NEW.tenant_id;

  IF NOT public.plan_feature(COALESCE(lic_plan, 'trial'), 'team') THEN
    RAISE EXCEPTION 'Your % plan is for a single advocate. Move to the Chamber plan (from Rs 7999/month for 2 users) to invite teammates.', COALESCE(lic_plan, 'trial')
      USING ERRCODE = '42501';
  END IF;

  SELECT
    (SELECT count(*) FROM public.profiles WHERE tenant_id = NEW.tenant_id) +
    (SELECT count(*) FROM public.tenant_invites WHERE tenant_id = NEW.tenant_id AND status = 'pending')
  INTO used;

  IF seat_cap IS NOT NULL AND used >= seat_cap THEN
    RAISE EXCEPTION 'This chamber has used all % seats. Add a seat at Rs 1999/month, or revoke a pending invite.', seat_cap
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.enforce_seat_limit() FROM PUBLIC, anon, authenticated;
