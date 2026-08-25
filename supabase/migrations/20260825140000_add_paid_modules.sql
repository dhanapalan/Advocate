------------------------------------------------------------- paid modules
-- Repricing moved from three fixed tiers to a required base plan (seats/
-- matters/diary/clients/billing) plus five separately-sold AI modules:
-- ai_drafting, ai_assistant (general assistant + Ask My Case), matter_
-- intelligence (morning brief + matter summaries + briefing), ocr (document
-- scan intake + AI review), dictation (transcribe + format). Enforced
-- server-side in each edge function via requireModule() (supabase/functions/
-- _shared/modules.ts) — reuses the existing licenses.integrations JSONB
-- column (same one WhatsApp/e-Courts/governance kill-switches already live
-- in), keyed "{module}_enabled", opt-in (default false) unlike the older
-- kill-switches (default true). Trial tenants get every module unlocked to
-- evaluate, same policy as trial_period already gives everything else.
--
-- my_entitlements() gains the five flags so the frontend can show/hide
-- module-gated UI, not just have the backend refuse the call. DROP first —
-- adding OUT columns changes the row type, which CREATE OR REPLACE refuses.
DROP FUNCTION IF EXISTS public.my_entitlements();
CREATE FUNCTION public.my_entitlements()
RETURNS TABLE(
  plan TEXT, status TEXT, seats INTEGER, seats_included INTEGER,
  seats_used INTEGER, extra_seats INTEGER, extra_seat_price_inr INTEGER,
  base_price_inr INTEGER, monthly_total_inr INTEGER,
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
  is_trial BOOLEAN;
BEGIN
  SELECT pr.tenant_id INTO t_id FROM public.profiles pr WHERE pr.id = auth.uid();
  IF t_id IS NULL THEN RETURN; END IF;

  SELECT * INTO l FROM public.licenses li WHERE li.tenant_id = t_id;
  IF NOT FOUND THEN RETURN; END IF;

  p := COALESCE(l.plan, 'trial');
  is_trial := (p = 'trial');
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
         ELSE NULL END,
    is_trial OR COALESCE((l.integrations ->> 'ai_drafting_enabled')::boolean, false),
    is_trial OR COALESCE((l.integrations ->> 'ai_assistant_enabled')::boolean, false),
    is_trial OR COALESCE((l.integrations ->> 'matter_intelligence_enabled')::boolean, false),
    is_trial OR COALESCE((l.integrations ->> 'dictation_enabled')::boolean, false);
END; $$;
REVOKE ALL ON FUNCTION public.my_entitlements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_entitlements() TO authenticated;
