-- SECURITY FIX (audit-trail integrity): log_auth_event() was callable by the
-- `anon` role, which makes the audit-log-auth Edge Function optional rather
-- than mandatory.
--
-- That Edge Function does real work: it allowlists the event type, requires a
-- verified JWT for login_success/logout (resolving actor_user_id server-side
-- from the token rather than trusting the body), and reads the client IP from
-- cf-connecting-ip. But it then wrote the row using the *anon* key, so the RPC
-- had to be granted to anon — and the publishable key is public by design and
-- shipped in the client bundle. Anyone could therefore POST straight to
-- /rest/v1/rpc/log_auth_event and skip every one of those checks.
--
-- The consequence is worse than "junk rows". log_auth_event() resolves the
-- tenant from the caller-supplied actor id:
--
--     SELECT tenant_id INTO row_tenant FROM public.profiles WHERE id = p_actor_user_id;
--
-- so a forged row is stamped with the VICTIM's tenant_id and appears in that
-- chamber's own /app/audit-log, attributing an arbitrary action, IP and
-- user-agent to a real user. audit_log is deliberately append-only (no UPDATE
-- or DELETE policy at all), so forged entries cannot be removed through the
-- app afterwards either. That is an unauthenticated cross-tenant write, and it
-- undermines the one table whose whole purpose is being trustworthy.
--
-- Fix: the Edge Function switches to the service-role client (same as
-- whatsapp-webhook/whatsapp-diary-digest already do), so the RPC no longer
-- needs to be reachable by anon or authenticated at all.
--
-- service_role must be granted EXECUTE **explicitly**. It does not inherit it:
-- `service_role` is not a superuser and is not a member of `postgres`, and the
-- original grant in 20260819121936_audit_log.sql named only `authenticated, anon`
-- — so the function's ACL was `{postgres=X/postgres, anon=X/…, authenticated=X/…}`
-- and service_role was never on it. It worked purely because the Edge Function
-- called the RPC with the anon key. Revoking without adding this GRANT leaves
-- the ACL at `{postgres=X/postgres}` and every auth event fails with
-- "permission denied for function log_auth_event". Caught by running this
-- migration against a local instance rather than by reading it.
--
-- Deploy order: APPLY THIS MIGRATION FIRST, then deploy the Edge Function.
--
-- Neither order is gapless, because the old function authenticates as `anon`
-- and the new one as `service_role`, and no single moment satisfies both:
--
--   migration first  -> the still-deployed old function loses access until the
--                       new one ships. The vulnerability closes immediately.
--   function first   -> the new function has no EXECUTE until this migration
--                       runs. The vulnerability stays open for longer, for the
--                       same cost.
--
-- Both gaps cost only auth-event logging, which is best-effort by design and
-- already swallowed at the call site (`.catch(() => undefined)` in
-- src/lib/edge-functions.ts) — a failure never blocks a login. So take the
-- order that shuts the hole sooner, and keep the window short.
--
-- (An earlier revision of this comment said the opposite. That was written
-- when this migration only revoked; adding the service_role GRANT inverted the
-- correct order.)
GRANT EXECUTE ON FUNCTION public.log_auth_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.log_auth_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.log_auth_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Writes an auth event (login/logout/signup) to audit_log. service_role only — callable exclusively by the audit-log-auth Edge Function, which validates the event type and resolves actor_user_id from a verified JWT. Never grant this to anon or authenticated: the tenant_id on the row is derived from the caller-supplied actor id, so a direct caller could forge entries into another tenant''s audit trail.';
