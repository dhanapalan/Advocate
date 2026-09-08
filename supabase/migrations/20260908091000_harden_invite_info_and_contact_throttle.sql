-- Two smaller hardening fixes from the same security review.

------------------------------------------------------ 1. get_invite_info leak
-- get_invite_info() is anon-callable by design — the /invite/:token landing
-- page has to render "You've been invited to join <firm>" before the visitor
-- has an account. But it returned tenant_name, email and role regardless of
-- whether the invite was still usable, so a link that had already been
-- accepted, revoked or expired kept disclosing the chamber's name and the
-- invitee's email address for as long as the row existed.
--
-- The token is a v4 UUID, so this is not enumerable — it only matters for
-- links that leak, which is exactly what invite links do: they get forwarded,
-- pasted into chats, and left in browser history precisely because the flow
-- has no transactional email and the inviter shares the link by hand (see
-- 20260819124319_team_invites.sql's own header). A spent link should stop
-- answering questions.
--
-- Shape is unchanged (same four columns, still one row for a real token, still
-- zero rows for a token that matches nothing) so the /invite route's existing
-- "no row -> generic fallback" handling keeps working untouched.
CREATE OR REPLACE FUNCTION public.get_invite_info(p_token UUID)
RETURNS TABLE(tenant_name TEXT, email TEXT, role TEXT, valid BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE WHEN usable THEN t_name END,
    CASE WHEN usable THEN i_email END,
    CASE WHEN usable THEN i_role END,
    usable
  FROM (
    SELECT
      t.name AS t_name,
      i.email AS i_email,
      i.role AS i_role,
      (i.status = 'pending' AND i.expires_at > now()) AS usable
    FROM public.tenant_invites i
    JOIN public.tenants t ON t.id = i.tenant_id
    WHERE i.token = p_token
  ) resolved;
$$;
REVOKE ALL ON FUNCTION public.get_invite_info(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_info(UUID) TO anon, authenticated;
COMMENT ON FUNCTION public.get_invite_info(UUID) IS
  'Anon-callable lookup for the /invite/:token landing page. Returns the chamber name, invited email and role ONLY while the invite is still pending and unexpired; a spent or expired token returns valid=false with every other column NULL, so a forwarded link stops disclosing who was invited to which chamber.';

--------------------------------------------- 2. contact_requests abuse control
-- The public "Request access" form is unauthenticated and writes with the
-- service-role client (src/lib/contact.functions.ts), and every submission
-- also fires a Resend email. There is no CAPTCHA and no rate limit anywhere in
-- this codebase, so a script can fill the table and burn the mail quota.
--
-- The throttle itself lives in submitContactRequest() as a "how many rows from
-- this email in the last hour" check; this index is what keeps that check from
-- degrading into a sequential scan as the table grows.
CREATE INDEX IF NOT EXISTS contact_requests_email_created_idx
  ON public.contact_requests (lower(email), created_at DESC);
