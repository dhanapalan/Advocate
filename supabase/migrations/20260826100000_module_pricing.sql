------------------------------------------------------------- module pricing
-- Companion to 20260825140000_add_paid_modules.sql, which added the five
-- module entitlement flags but no price for them — my_entitlements()'s
-- monthly_total_inr never reflected a purchased module at all. Closes that:
-- assigning a module from /admin/settings/integrations now actually moves
-- the calculated total, both in the admin's own view and in the tenant's
-- own Billing summary (app.team.tsx, which already renders monthly_total_inr).
--
-- Flat per tenant, not per seat (user decision) — a module costs the same
-- whether it's a solo advocate or a 5-seat chamber.
--
-- PLACEHOLDER PRICING: Rs 499/month for every module, explicitly provisional
-- (user decision — ship the calculation mechanism now, set real prices
-- later). Flagged again in the admin UI so nobody sells off this number
-- thinking it's final.
CREATE OR REPLACE FUNCTION public.module_price_inr(p_module TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_module
    WHEN 'ai_drafting' THEN 499
    WHEN 'ai_assistant' THEN 499
    WHEN 'matter_intelligence' THEN 499
    WHEN 'ocr' THEN 499
    WHEN 'dictation' THEN 499
    ELSE NULL
  END;
$$;
COMMENT ON FUNCTION public.module_price_inr IS
  'Monthly rupee price for one paid module, flat per tenant regardless of seats. PLACEHOLDER pricing (Rs 499 across the board) — set real prices before relying on this for real billing.';
REVOKE ALL ON FUNCTION public.module_price_inr(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.module_price_inr(TEXT) TO authenticated;

-- Same body as 20260825140000_add_paid_modules.sql's my_entitlements(), with
-- monthly_total_inr now including the sum of actually-purchased modules
-- (integrations flags, NOT the trial-unlocked booleans below — a trial
-- tenant evaluating every module isn't being charged for any of them).
DROP FUNCTION IF EXISTS public.my_entitlements();
CREATE FUNCTION public.my_entitlements()
RETURNS TABLE(
  plan TEXT, status TEXT, seats INTEGER, seats_included INTEGER,
  seats_used INTEGER, extra_seats INTEGER, extra_seat_price_inr INTEGER,
  base_price_inr INTEGER, modules_total_inr INTEGER, monthly_total_inr INTEGER,
  ocr_enabled BOOLEAN, whatsapp_enabled BOOLEAN, team_enabled BOOLEAN,
  matters_limit INTEGER, clients_limit INTEGER, storage_limit_mb INTEGER,
  trial_ends_at TIMESTAMPTZ, trial_days_left INTEGER, trial_expired BOOLEAN,
  trial_period_days INTEGER,
  billing_cadence TEXT, current_period_end TIMESTAMPTZ,
  subscription_expired BOOLEAN, subscription_grace_days_left INTEGER,
  ai_drafting_enabled BOOLEAN, ai_assistant_enabled BOOLEAN,
  matter_intelligence_enabled BOOLEAN, dictation_enabled BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t_id UUID;
  l RECORD;
  p TEXT;
  included INTEGER;
  used INTEGER;
  extra INTEGER;
  seat_price INTEGER;
  base_price INTEGER;
  modules_total INTEGER;
  is_trial BOOLEAN;
  integrations JSONB;
BEGIN
  SELECT pr.tenant_id INTO t_id FROM public.profiles pr WHERE pr.id = auth.uid();
  IF t_id IS NULL THEN RETURN; END IF;

  SELECT * INTO l FROM public.licenses li WHERE li.tenant_id = t_id;
  IF NOT FOUND THEN RETURN; END IF;

  p := COALESCE(l.plan, 'trial');
  is_trial := (p = 'trial');
  integrations := COALESCE(l.integrations, '{}'::jsonb);
  included := public.plan_limit(p, 'seats_included');
  seat_price := COALESCE(l.legacy_extra_seat_price_inr, public.plan_price_inr(p, 'extra_seat'));
  base_price := COALESCE(l.legacy_base_price_inr, public.plan_price_inr(p, 'base'));

  modules_total :=
    (CASE WHEN COALESCE((integrations ->> 'ai_drafting_enabled')::boolean, false)
          THEN public.module_price_inr('ai_drafting') ELSE 0 END) +
    (CASE WHEN COALESCE((integrations ->> 'ai_assistant_enabled')::boolean, false)
          THEN public.module_price_inr('ai_assistant') ELSE 0 END) +
    (CASE WHEN COALESCE((integrations ->> 'matter_intelligence_enabled')::boolean, false)
          THEN public.module_price_inr('matter_intelligence') ELSE 0 END) +
    (CASE WHEN COALESCE((integrations ->> 'ocr_enabled')::boolean, false)
          THEN public.module_price_inr('ocr') ELSE 0 END) +
    (CASE WHEN COALESCE((integrations ->> 'dictation_enabled')::boolean, false)
          THEN public.module_price_inr('dictation') ELSE 0 END);

  -- tenant_invites.status must be table-qualified: this function has an OUT
  -- parameter also named "status", and an unqualified reference is ambiguous.
  SELECT
    (SELECT count(*) FROM public.profiles pr WHERE pr.tenant_id = t_id) +
    (SELECT count(*) FROM public.tenant_invites ti WHERE ti.tenant_id = t_id AND ti.status = 'pending')
  INTO used;

  extra := GREATEST(COALESCE(l.seats, included) - included, 0);

  RETURN QUERY SELECT
    p,
    l.status,
    l.seats,
    included,
    used,
    extra,
    seat_price,
    base_price,
    modules_total,
    base_price + (extra * COALESCE(seat_price, 0)) + modules_total,
    public.plan_feature(p, 'ocr'),
    public.plan_feature(p, 'whatsapp') AND COALESCE((integrations ->> 'whatsapp_enabled')::boolean, false),
    public.plan_feature(p, 'team'),
    public.plan_limit(p, 'matters'),
    public.plan_limit(p, 'clients'),
    public.plan_limit(p, 'storage_mb'),
    l.trial_ends_at,
    CASE WHEN l.plan = 'trial' AND l.trial_ends_at IS NOT NULL
         THEN GREATEST(CEIL(EXTRACT(EPOCH FROM (l.trial_ends_at - now())) / 86400)::INTEGER, 0)
         ELSE NULL END,
    public.trial_expired(t_id),
    public.trial_period_days(),
    l.billing_cadence,
    l.current_period_end,
    public.subscription_expired(t_id),
    CASE WHEN l.plan <> 'trial' AND l.current_period_end IS NOT NULL
         THEN GREATEST(CEIL(EXTRACT(EPOCH FROM (
                (l.current_period_end + (public.subscription_grace_days() || ' days')::interval) - now()
              )) / 86400)::INTEGER, 0)
         ELSE NULL END,
    is_trial OR COALESCE((integrations ->> 'ai_drafting_enabled')::boolean, false),
    is_trial OR COALESCE((integrations ->> 'ai_assistant_enabled')::boolean, false),
    is_trial OR COALESCE((integrations ->> 'matter_intelligence_enabled')::boolean, false),
    is_trial OR COALESCE((integrations ->> 'dictation_enabled')::boolean, false);
END; $$;
REVOKE ALL ON FUNCTION public.my_entitlements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_entitlements() TO authenticated;
