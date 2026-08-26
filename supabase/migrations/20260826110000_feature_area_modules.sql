------------------------------------------------------ feature-area modules
-- Second half of the module-selling pivot: the five AI features already had
-- their own price/entitlement keys (20260825140000, 20260826100000). Pricing
-- now moves the *rest* of the app the same way — matters, clients, diary
-- (incl. cause-list), documents, billing each become their own sellable
-- module instead of one indivisible "required base plan". A tenant can now
-- legitimately hold e.g. only clients+documents.
--
-- Two module keys are retired here rather than kept alongside the new ones:
-- 'ocr' merges into 'documents' (OCR intake writes into the same ai_documents
-- table Documents already owns, and product copy already describes them as
-- one feature — "Documents with Indic OCR & AI review"); 'dictation' merges
-- into 'ai_drafting' (dictation writes into the same ai_drafts table
-- Drafting owns, and today does so with NO entitlement check at all — a
-- tenant buying only Dictation could already fill the drafting studio for
-- free; merging closes that gap rather than building cross-module
-- write-gating for a distinction with no real product value).
CREATE OR REPLACE FUNCTION public.module_price_inr(p_module TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_module
    WHEN 'matters' THEN 499
    WHEN 'clients' THEN 499
    WHEN 'diary' THEN 499
    WHEN 'documents' THEN 499
    WHEN 'billing' THEN 499
    WHEN 'ai_drafting' THEN 499
    WHEN 'ai_assistant' THEN 499
    WHEN 'matter_intelligence' THEN 499
    ELSE NULL
  END;
$$;
COMMENT ON FUNCTION public.module_price_inr IS
  'Monthly rupee price for one paid module, flat per tenant regardless of seats. PLACEHOLDER pricing (Rs 499 across the board) — set real prices before relying on this for real billing. ocr/dictation retired: see 20260826110000.';

-- Grandfather every already-active paid license onto the 5 new modules —
-- they were part of the old indivisible "required base plan" this replaces,
-- already paid for. Without this, the moment enforcement goes live any real
-- non-trial tenant loses matters/clients/diary/documents/billing outright.
-- Trial tenants are unaffected either way (requireModule's trial bypass
-- already gives them everything); this only matters for paid licenses, of
-- which there are none live as of this migration — written correctly
-- regardless, since this is exactly the mechanism that matters the moment a
-- real tenant converts.
UPDATE public.licenses
SET integrations = integrations
  || '{"matters_enabled": true, "clients_enabled": true, "diary_enabled": true, "documents_enabled": true, "billing_enabled": true}'::jsonb
WHERE plan <> 'trial';

-- Same body as 20260826100000_module_pricing.sql's my_entitlements(), with
-- five more module flags/price contributions. DROP+CREATE, not CREATE OR
-- REPLACE — adding OUT columns changes the row type.
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
  matter_intelligence_enabled BOOLEAN,
  matters_enabled BOOLEAN, clients_enabled BOOLEAN, diary_enabled BOOLEAN,
  documents_enabled BOOLEAN, billing_enabled BOOLEAN
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
    (CASE WHEN COALESCE((integrations ->> 'matters_enabled')::boolean, false)
          THEN public.module_price_inr('matters') ELSE 0 END) +
    (CASE WHEN COALESCE((integrations ->> 'clients_enabled')::boolean, false)
          THEN public.module_price_inr('clients') ELSE 0 END) +
    (CASE WHEN COALESCE((integrations ->> 'diary_enabled')::boolean, false)
          THEN public.module_price_inr('diary') ELSE 0 END) +
    (CASE WHEN COALESCE((integrations ->> 'documents_enabled')::boolean, false)
          THEN public.module_price_inr('documents') ELSE 0 END) +
    (CASE WHEN COALESCE((integrations ->> 'billing_enabled')::boolean, false)
          THEN public.module_price_inr('billing') ELSE 0 END);

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
    is_trial OR COALESCE((integrations ->> 'matters_enabled')::boolean, false),
    is_trial OR COALESCE((integrations ->> 'clients_enabled')::boolean, false),
    is_trial OR COALESCE((integrations ->> 'diary_enabled')::boolean, false),
    is_trial OR COALESCE((integrations ->> 'documents_enabled')::boolean, false),
    is_trial OR COALESCE((integrations ->> 'billing_enabled')::boolean, false);
END; $$;
REVOKE ALL ON FUNCTION public.my_entitlements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_entitlements() TO authenticated;
