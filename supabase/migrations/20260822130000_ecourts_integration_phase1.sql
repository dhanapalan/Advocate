-- e-Courts integration, Phase 1: CNR verify + auto-fill on matter creation.
--
-- There is no official government API for third-party commercial use — only
-- third-party providers who resell scraped e-Courts data. This migration is
-- deliberately vendor-agnostic: matters.cnr and the usage/log tables don't
-- care which provider answers a lookup (see supabase/functions/_shared/
-- ecourts.ts, added alongside this migration, for the swappable client).
--
-- Phase 2 (scheduled auto-refresh) and Phase 3 (auto-import orders as
-- documents) are designed but NOT implemented here — they wait on Phase 1's
-- real-world vendor comparison before committing to the much larger,
-- recurring cost of nightly polling across every tracked matter.

--------------------------------------------------------------------- matters
ALTER TABLE public.matters ADD COLUMN cnr TEXT;
ALTER TABLE public.matters ADD CONSTRAINT matters_cnr_format_check
  CHECK (cnr IS NULL OR cnr ~ '^[A-Za-z0-9]{16}$');
CREATE INDEX matters_cnr_idx ON public.matters (cnr) WHERE cnr IS NOT NULL;

------------------------------------------------------ cause_list_sources
-- The cause_list_intelligence migration's own header comment anticipated
-- exactly this: "a live api/scrape source_type can be added later without
-- touching this shape." Not used by Phase 1 (that's plain CNR lookup, not a
-- cause-list source) — reserved for when Phase 2/3 need to represent "this
-- tenant's e-Courts feed" as a source alongside manual-paste sources.
ALTER TABLE public.cause_list_sources DROP CONSTRAINT cause_list_sources_source_type_check;
ALTER TABLE public.cause_list_sources ADD CONSTRAINT cause_list_sources_source_type_check
  CHECK (source_type IN ('manual_import', 'ecourts_api'));

------------------------------------------------------------- ecourts_sync_log
-- Delivery/attempt log, one row per lookup — same shape as whatsapp_messages.
-- Admin-visible only, same visibility line as every other operational log in
-- this app.
CREATE TABLE public.ecourts_sync_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants ON DELETE CASCADE,
  matter_id UUID REFERENCES public.matters ON DELETE SET NULL,
  cnr TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  status_detail TEXT,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ecourts_sync_log_tenant_idx ON public.ecourts_sync_log (tenant_id, created_at DESC);
CREATE INDEX ecourts_sync_log_matter_idx ON public.ecourts_sync_log (matter_id, created_at DESC);

GRANT SELECT ON public.ecourts_sync_log TO authenticated;
GRANT ALL ON public.ecourts_sync_log TO service_role;
ALTER TABLE public.ecourts_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant admins view own tenant ecourts log" ON public.ecourts_sync_log
  FOR SELECT TO authenticated USING (public.is_tenant_admin(tenant_id));

-- INSERT is via the authenticated caller directly for Phase 1 (ecourts-lookup
-- is a normal user-JWT function, unlike the WhatsApp digest's service-role
-- job) — so, unlike whatsapp_messages, authenticated does get an INSERT
-- grant here, scoped to the caller's own tenant only.
GRANT INSERT ON public.ecourts_sync_log TO authenticated;
CREATE POLICY "Tenant members log own tenant ecourts lookups" ON public.ecourts_sync_log
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());

---------------------------------------------------------- ecourts_usage_daily
-- Cost-control cap, tenant-keyed — mirrors whatsapp_usage_daily exactly,
-- including taking the IST date as an explicit argument rather than
-- defaulting to Postgres current_date.
CREATE TABLE public.ecourts_usage_daily (
  tenant_id UUID NOT NULL REFERENCES public.tenants ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  lookup_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, usage_date)
);
GRANT SELECT ON public.ecourts_usage_daily TO authenticated;
GRANT ALL ON public.ecourts_usage_daily TO service_role;
ALTER TABLE public.ecourts_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant admins view own tenant ecourts usage" ON public.ecourts_usage_daily
  FOR SELECT TO authenticated USING (public.is_tenant_admin(tenant_id));

-- SECURITY DEFINER, callable by an authenticated user (unlike
-- increment_whatsapp_usage, which is service_role-only) — Phase 1's lookup
-- is a live user action, so it uses the caller's own tenant via
-- current_tenant_id(), matching increment_ai_usage()'s auth.uid()-derived
-- pattern rather than taking an explicit tenant argument.
CREATE OR REPLACE FUNCTION public.increment_ecourts_usage()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_count INTEGER;
  v_tenant_id UUID := public.current_tenant_id();
  tenant_plan TEXT;
  daily_cap INTEGER;
  ist_date DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT plan INTO tenant_plan FROM public.licenses WHERE tenant_id = v_tenant_id;
  daily_cap := public.plan_limit(tenant_plan, 'ecourts_lookups_per_day');

  INSERT INTO public.ecourts_usage_daily (tenant_id, usage_date, lookup_count)
  VALUES (v_tenant_id, ist_date, 1)
  ON CONFLICT (tenant_id, usage_date)
  DO UPDATE SET lookup_count = public.ecourts_usage_daily.lookup_count + 1
  RETURNING lookup_count INTO new_count;

  IF daily_cap IS NOT NULL AND new_count > daily_cap THEN
    RAISE EXCEPTION 'e-Courts daily lookup cap (%) exceeded for this chamber', daily_cap
      USING ERRCODE = '22023';
  END IF;

  RETURN new_count;
END; $$;
REVOKE ALL ON FUNCTION public.increment_ecourts_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_ecourts_usage() TO authenticated;

-------------------------------------------------------------- plan_limit arm
-- Placeholder caps — real cost depends on which vendor Phase 1's pilot
-- settles on (eCourtsIndia.com's credit pricing and Vakeel360's undisclosed
-- pricing are very different cost bases). Revisit before enabling broadly.
CREATE OR REPLACE FUNCTION public.plan_limit(p_plan TEXT, p_resource TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_resource
    WHEN 'matters' THEN
      CASE p_plan WHEN 'trial' THEN 10 WHEN 'solo_basic' THEN 50 WHEN 'solo_pro' THEN 200 ELSE NULL END
    WHEN 'clients' THEN
      CASE p_plan WHEN 'trial' THEN 10 WHEN 'solo_basic' THEN 50 WHEN 'solo_pro' THEN 200 ELSE NULL END
    WHEN 'ai_calls_per_day' THEN
      CASE p_plan WHEN 'trial' THEN 20 WHEN 'solo_basic' THEN 40 WHEN 'solo_pro' THEN 150 WHEN 'chamber' THEN 400 ELSE 20 END
    WHEN 'storage_mb' THEN
      CASE p_plan WHEN 'trial' THEN 100 WHEN 'solo_basic' THEN 1000 WHEN 'solo_pro' THEN 5000 WHEN 'chamber' THEN 25000 ELSE 100 END
    WHEN 'seats_included' THEN
      CASE p_plan WHEN 'chamber' THEN 2 ELSE 1 END
    WHEN 'whatsapp_messages_per_day' THEN
      CASE p_plan WHEN 'trial' THEN 10 WHEN 'solo_basic' THEN 20 WHEN 'solo_pro' THEN 50 WHEN 'chamber' THEN 150 ELSE 10 END
    WHEN 'ecourts_lookups_per_day' THEN
      CASE p_plan WHEN 'trial' THEN 5 WHEN 'solo_basic' THEN 10 WHEN 'solo_pro' THEN 30 WHEN 'chamber' THEN 100 ELSE 5 END
    ELSE NULL
  END;
$$;
COMMENT ON FUNCTION public.plan_limit IS 'NULL return means unlimited for that plan/resource.';

-- licenses.integrations.ecourts_enabled is read via
-- COALESCE((integrations->>'ecourts_enabled')::boolean, false) at every call
-- site (see ecourts-lookup/index.ts) — absent means false. Deliberately NOT
-- given a column default and NOT set to true anywhere for existing or new
-- tenants, unlike whatsapp_enabled. That default caused a real incident this
-- session (a live test swept up a real tenant because the flag defaulted on
-- for everyone); e-Courts lookups cost real money on every call with no
-- consent layer to soften a mistake, so this one is opt-in, per-tenant,
-- enabled deliberately during rollout — never a broad default.
