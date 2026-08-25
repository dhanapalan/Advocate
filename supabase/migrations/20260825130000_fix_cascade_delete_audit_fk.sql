------------------------------------------- fix cascade-delete audit FK crash
-- Deleting a tenant is currently broken for ANY tenant that has a license
-- (i.e. every tenant): DELETE FROM tenants cascades to licenses, whose
-- BEFORE DELETE trigger (log_license_admin_action, licenses_audit_log_delete
-- per 20260821130000) tries to INSERT INTO audit_log(tenant_id = OLD.tenant_id)
-- — but by the time a cascaded child delete fires, the parent tenants row is
-- already gone from the table, so that INSERT violates audit_log's own FK
-- back to tenants. Reproduced live via `supabase db push`'s underlying
-- connection while cleaning up test tenants from the admin panel — every
-- attempt to delete a tenant with a license fails with error 23503.
--
-- tenants' own BEFORE DELETE trigger (tenants_audit_log_delete) doesn't have
-- this problem — it fires before ITS OWN row is gone, so the FK still holds
-- — and it already logs the tenant deletion itself (resource_type='tenants').
-- So the fix for the cascaded child triggers is just to skip logging when
-- the parent tenant no longer exists, rather than erroring: there is nothing
-- useful to log for a resource whose own tenant_id can never be read back
-- again anyway, and the tenant-level deletion is already captured.
CREATE OR REPLACE FUNCTION public.log_license_admin_action() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = COALESCE(NEW.tenant_id, OLD.tenant_id)) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.audit_log (tenant_id, actor_user_id, actor_email, action, resource_type, resource_id, metadata)
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id), auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    lower(TG_OP), 'licenses', COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'UPDATE' THEN
      jsonb_build_object(
        'plan', NEW.plan, 'old_plan', OLD.plan,
        'status', NEW.status, 'old_status', OLD.status,
        'billing_cadence', NEW.billing_cadence,
        'current_period_end', NEW.current_period_end
      )
    ELSE
      jsonb_build_object('plan', COALESCE(NEW.plan, OLD.plan), 'status', COALESCE(NEW.status, OLD.status))
    END
  );
  RETURN COALESCE(NEW, OLD);
END; $$;

-- log_tenant_mutation() (matters/clients/hearings/time_entries/invoices/
-- ai_documents/ai_drafts/ai_conversations) has the exact same shape of risk
-- — every one of those tables cascades from tenants too. Same guard.
CREATE OR REPLACE FUNCTION public.log_tenant_mutation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_tenant UUID;
  row_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_tenant := OLD.tenant_id;
    row_id := OLD.id;
  ELSE
    row_tenant := NEW.tenant_id;
    row_id := NEW.id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = row_tenant) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.audit_log (tenant_id, actor_user_id, actor_email, action, resource_type, resource_id)
  VALUES (
    row_tenant, auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    lower(TG_OP), TG_TABLE_NAME, row_id
  );
  RETURN COALESCE(NEW, OLD);
END; $$;
