------------------------------------------------- grandfathered license pricing
-- Companion to 20260825120000_update_plan_pricing.sql. One real tenant
-- (Krishnan & Associates, chamber plan, 4 seats, active since 2026-08-20) was
-- already paying at the old prices when this repricing landed. Rather than
-- silently jumping their bill 6x with no notice, licenses now carries an
-- optional per-tenant price lock: NULL (the default, and the case for every
-- other tenant) means "use plan_price_inr() like normal"; a non-NULL value
-- overrides it. Nothing about plan_price_inr() itself, or any other tenant,
-- changes.
ALTER TABLE public.licenses
  ADD COLUMN IF NOT EXISTS legacy_base_price_inr INTEGER,
  ADD COLUMN IF NOT EXISTS legacy_extra_seat_price_inr INTEGER;
COMMENT ON COLUMN public.licenses.legacy_base_price_inr IS
  'Per-tenant price override, NULL by default (use plan_price_inr(plan, ''base'')). Set only to grandfather a specific tenant onto a price they originally signed up at. If this tenant is ever moved to a different plan tier, clear this column too — it is not plan-specific.';
COMMENT ON COLUMN public.licenses.legacy_extra_seat_price_inr IS
  'Per-tenant price override, NULL by default (use plan_price_inr(plan, ''extra_seat'')). See legacy_base_price_inr.';

-- Same body as 20260820130000_subscription_expiry.sql's my_entitlements(),
-- with base_price_inr/extra_seat_price_inr now resolved through the license's
-- own override before falling back to the plan-wide price.
CREATE OR REPLACE FUNCTION public.my_entitlements()
RETURNS TABLE(
  plan TEXT, status TEXT, seats INTEGER, seats_included INTEGER,
  seats_used INTEGER, extra_seats INTEGER, extra_seat_price_inr INTEGER,
  base_price_inr INTEGER, monthly_total_inr INTEGER,
  ocr_enabled BOOLEAN, whatsapp_enabled BOOLEAN, team_enabled BOOLEAN,
  matters_limit INTEGER, clients_limit INTEGER, storage_limit_mb INTEGER,
  trial_ends_at TIMESTAMPTZ, trial_days_left INTEGER, trial_expired BOOLEAN,
  trial_period_days INTEGER,
  billing_cadence TEXT, current_period_end TIMESTAMPTZ,
  subscription_expired BOOLEAN, subscription_grace_days_left INTEGER
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
BEGIN
  SELECT pr.tenant_id INTO t_id FROM public.profiles pr WHERE pr.id = auth.uid();
  IF t_id IS NULL THEN RETURN; END IF;

  SELECT * INTO l FROM public.licenses li WHERE li.tenant_id = t_id;
  IF NOT FOUND THEN RETURN; END IF;

  p := COALESCE(l.plan, 'trial');
  included := public.plan_limit(p, 'seats_included');
  seat_price := COALESCE(l.legacy_extra_seat_price_inr, public.plan_price_inr(p, 'extra_seat'));
  base_price := COALESCE(l.legacy_base_price_inr, public.plan_price_inr(p, 'base'));

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
    base_price + (extra * COALESCE(seat_price, 0)),
    public.plan_feature(p, 'ocr'),
    public.plan_feature(p, 'whatsapp') AND COALESCE((l.integrations ->> 'whatsapp_enabled')::boolean, false),
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
         ELSE NULL END;
END; $$;
REVOKE ALL ON FUNCTION public.my_entitlements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_entitlements() TO authenticated;

-- The actual grandfather: lock Krishnan & Associates (the one real chamber
-- tenant active before this repricing) onto what they were already paying —
-- Rs 999 base + Rs 499/extra seat, the prices in effect when they signed up
-- on 2026-08-20. No other tenant is touched.
UPDATE public.licenses
SET legacy_base_price_inr = 999, legacy_extra_seat_price_inr = 499
WHERE tenant_id = 'bfd6611e-7818-4680-a39f-922646535ed3';
