-- Migration 0003: atomic invitation accept + helper for member self-removal check
-- Idempotent. Applied ad-hoc via supabase CLI / dashboard SQL editor.

-- ==========================================================================
-- accept_invitation(invitation_id uuid)
--
-- Manual-accept path for an invitee who ALREADY has an account. Runs as
-- SECURITY DEFINER because the caller (invitee) is not yet a budget_member
-- and so can't satisfy budget_members_insert_owner's is_budget_owner check.
--
-- Validates: the invitation matches the caller's email, is still pending,
-- and hasn't expired. Then atomically inserts the budget_members row and
-- marks the invitation accepted.
--
-- Returns jsonb { ok, budget_id, role } on success, { ok:false, error } on
-- any validation failure. Callers map the `error` string to HTTP status
-- (expired/not-pending → 409, not-for-you → 403, not-found → 404).
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.accept_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv         RECORD;
  user_email  text;
BEGIN
  SELECT email INTO user_email FROM public.users WHERE id = auth.uid();
  IF user_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  SELECT * INTO inv FROM public.invitations WHERE id = p_invitation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Case-insensitive email match (bank accounts often surface mixed case).
  IF lower(inv.email) <> lower(user_email) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_for_you');
  END IF;

  IF inv.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  IF inv.expires_at <= now() THEN
    -- Also mark expired ones as declined so they stop showing in the list.
    UPDATE public.invitations SET status = 'declined' WHERE id = inv.id;
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  INSERT INTO public.budget_members (budget_id, user_id, role)
  VALUES (inv.budget_id, auth.uid(), inv.role)
  ON CONFLICT (budget_id, user_id) DO NOTHING;

  UPDATE public.invitations SET status = 'accepted' WHERE id = inv.id;

  RETURN jsonb_build_object(
    'ok', true,
    'budget_id', inv.budget_id,
    'role', inv.role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid) TO authenticated;

-- ==========================================================================
-- decline_invitation(invitation_id uuid)
--
-- Counterpart to accept_invitation. Could be a pure PATCH via RLS, but
-- going through a function keeps the email-match check server-side so a
-- malicious user can't silently decline invites addressed to someone else
-- (the RLS policy already prevents this, but belt + suspenders).
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.decline_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv         RECORD;
  user_email  text;
BEGIN
  SELECT email INTO user_email FROM public.users WHERE id = auth.uid();
  IF user_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  SELECT * INTO inv FROM public.invitations WHERE id = p_invitation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF lower(inv.email) <> lower(user_email) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_for_you');
  END IF;

  IF inv.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE public.invitations SET status = 'declined' WHERE id = inv.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO authenticated;

-- ==========================================================================
-- list_my_pending_invitations()
--
-- Returns invitations addressed to the caller + the name/type of the budget
-- they're being invited to. Invitees aren't members yet, so RLS on budgets
-- blocks a normal SELECT — this function bridges that gap with a targeted
-- SECURITY DEFINER query limited to invitations the caller can already see.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.list_my_pending_invitations()
RETURNS TABLE (
  invitation_id uuid,
  budget_id     uuid,
  budget_name   text,
  budget_type   public.budget_type,
  invited_by    uuid,
  inviter_name  text,
  role          public.budget_role,
  expires_at    timestamptz,
  created_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    i.id,
    i.budget_id,
    b.name,
    b.type,
    i.invited_by,
    inviter.display_name,
    i.role,
    i.expires_at,
    i.created_at
  FROM public.invitations i
  JOIN public.budgets b  ON b.id = i.budget_id
  JOIN public.users   me ON me.id = auth.uid()
  LEFT JOIN public.users inviter ON inviter.id = i.invited_by
  WHERE lower(i.email) = lower(me.email)
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_pending_invitations() TO authenticated;
