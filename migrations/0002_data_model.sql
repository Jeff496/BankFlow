-- Migration 0002: core data model + RLS + triggers
-- Run via Supabase SQL editor (Database → SQL Editor → New query).
-- Idempotent: safe to re-run.

-- =============================================================
-- 1. ENUMS
-- =============================================================
DO $$ BEGIN
  CREATE TYPE public.budget_type AS ENUM ('personal', 'group');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.budget_role AS ENUM ('owner', 'editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invitation_status AS ENUM ('pending', 'accepted', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.upload_status AS ENUM ('processing', 'complete', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 2. TABLES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.budgets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  type         public.budget_type NOT NULL,
  owner_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sheet_id     text,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.budget_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role        public.budget_role NOT NULL,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  invited_by  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        public.budget_role NOT NULL,
  status      public.invitation_status NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  CHECK (role IN ('editor', 'viewer'))
);

CREATE TABLE IF NOT EXISTS public.categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id       uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  name            text NOT NULL,
  monthly_limit   numeric(12,2),
  keywords        text[] NOT NULL DEFAULT '{}',
  color           text NOT NULL DEFAULT '#6b7280',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id     uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  uploaded_by   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  row_count     integer NOT NULL DEFAULT 0,
  status        public.upload_status NOT NULL DEFAULT 'processing',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id     uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  upload_id     uuid NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  uploaded_by   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date          date NOT NULL,
  description   text NOT NULL,
  amount        numeric(12,2) NOT NULL,
  category_id   uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  hash          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.column_mappings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  bank_name   text NOT NULL,
  mapping     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, bank_name)
);

-- =============================================================
-- 3. INDEXES
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_transactions_budget_date
  ON public.transactions (budget_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_budget_category
  ON public.transactions (budget_id, category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_upload
  ON public.transactions (upload_id);
CREATE INDEX IF NOT EXISTS idx_transactions_hash_budget
  ON public.transactions (hash, budget_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email_status
  ON public.invitations (email, status);
CREATE INDEX IF NOT EXISTS idx_budget_members_user
  ON public.budget_members (user_id);

-- =============================================================
-- 4. RLS HELPER FUNCTIONS (SECURITY DEFINER, locked search_path)
-- Used inside policy expressions to avoid self-referential subqueries
-- on budget_members that would otherwise trigger infinite recursion.
-- =============================================================
CREATE OR REPLACE FUNCTION public.is_budget_member(p_budget_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budget_members
    WHERE budget_id = p_budget_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_budget_owner(p_budget_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budget_members
    WHERE budget_id = p_budget_id AND user_id = p_user_id AND role = 'owner'
  );
$$;

-- True when user has write capability (owner|editor) AND budget is not archived.
-- Used by RLS WITH CHECK on transactions/categories/uploads.
CREATE OR REPLACE FUNCTION public.is_budget_writer(p_budget_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.budget_members bm
    JOIN public.budgets b ON b.id = bm.budget_id
    WHERE bm.budget_id = p_budget_id
      AND bm.user_id = p_user_id
      AND bm.role IN ('owner', 'editor')
      AND b.archived_at IS NULL
  );
$$;

-- True when two users share at least one budget. Used for users RLS so we
-- can render "uploaded by" names and member lists without leaking profiles.
CREATE OR REPLACE FUNCTION public.are_budget_peers(p_user_a uuid, p_user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.budget_members a
    JOIN public.budget_members b ON a.budget_id = b.budget_id
    WHERE a.user_id = p_user_a AND b.user_id = p_user_b
  );
$$;

-- =============================================================
-- 5. UPDATED_AT TRIGGER
-- =============================================================
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS budgets_set_updated_at ON public.budgets;
CREATE TRIGGER budgets_set_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS categories_set_updated_at ON public.categories;
CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS transactions_set_updated_at ON public.transactions;
CREATE TRIGGER transactions_set_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =============================================================
-- 6. CREATE_BUDGET_OWNER_MEMBERSHIP TRIGGER
-- Inserts the first budget_members row atomically with budget creation.
-- MUST be SECURITY DEFINER: budget_members INSERT policy requires the
-- caller to already be an owner of the budget — a chicken-and-egg cycle
-- when creating the first owner row. API routes must NEVER insert the
-- first owner row directly.
-- =============================================================
CREATE OR REPLACE FUNCTION public.create_budget_owner_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.budget_members (budget_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS budgets_create_owner_membership ON public.budgets;
CREATE TRIGGER budgets_create_owner_membership
  AFTER INSERT ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.create_budget_owner_membership();

-- =============================================================
-- 7. EXTEND handle_new_user TO AUTO-ACCEPT INVITATIONS
-- (Profile row insertion was added in migration 0001; here we add the
-- invitations auto-accept loop.)
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv RECORD;
BEGIN
  INSERT INTO public.users (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;

  -- Auto-accept any pending, unexpired invitations matching this email
  FOR inv IN
    SELECT id, budget_id, role
    FROM public.invitations
    WHERE email = NEW.email
      AND status = 'pending'
      AND expires_at > now()
  LOOP
    INSERT INTO public.budget_members (budget_id, user_id, role)
    VALUES (inv.budget_id, NEW.id, inv.role)
    ON CONFLICT (budget_id, user_id) DO NOTHING;

    UPDATE public.invitations SET status = 'accepted' WHERE id = inv.id;
  END LOOP;

  RETURN NEW;
END;
$$;

-- =============================================================
-- 8. RLS POLICIES
-- =============================================================
ALTER TABLE public.budgets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.column_mappings ENABLE ROW LEVEL SECURITY;

-- ----- budgets -----
-- SELECT policy includes owner_id shortcut so that INSERT ... RETURNING works
-- for owners. Without it, Postgres applies SELECT USING to the newly-inserted
-- row before the AFTER trigger's budget_members row becomes visible to the
-- current command snapshot, making is_budget_member() return false and the
-- RETURNING clause fail with 42501.
DROP POLICY IF EXISTS budgets_select ON public.budgets;
CREATE POLICY budgets_select ON public.budgets
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR public.is_budget_member(id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS budgets_insert ON public.budgets;
CREATE POLICY budgets_insert ON public.budgets
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS budgets_update_owner ON public.budgets;
CREATE POLICY budgets_update_owner ON public.budgets
  FOR UPDATE TO authenticated
  USING (public.is_budget_owner(id, auth.uid()))
  WITH CHECK (public.is_budget_owner(id, auth.uid()));

DROP POLICY IF EXISTS budgets_delete_owner ON public.budgets;
CREATE POLICY budgets_delete_owner ON public.budgets
  FOR DELETE TO authenticated
  USING (public.is_budget_owner(id, auth.uid()));

-- ----- budget_members -----
DROP POLICY IF EXISTS budget_members_select ON public.budget_members;
CREATE POLICY budget_members_select ON public.budget_members
  FOR SELECT TO authenticated
  USING (public.is_budget_member(budget_id, auth.uid()));

DROP POLICY IF EXISTS budget_members_insert_owner ON public.budget_members;
CREATE POLICY budget_members_insert_owner ON public.budget_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_budget_owner(budget_id, auth.uid()));

DROP POLICY IF EXISTS budget_members_update_owner ON public.budget_members;
CREATE POLICY budget_members_update_owner ON public.budget_members
  FOR UPDATE TO authenticated
  USING (public.is_budget_owner(budget_id, auth.uid()))
  WITH CHECK (public.is_budget_owner(budget_id, auth.uid()));

-- Owners can kick members; members can leave.
DROP POLICY IF EXISTS budget_members_delete ON public.budget_members;
CREATE POLICY budget_members_delete ON public.budget_members
  FOR DELETE TO authenticated
  USING (
    public.is_budget_owner(budget_id, auth.uid())
    OR user_id = auth.uid()
  );

-- ----- invitations -----
DROP POLICY IF EXISTS invitations_select ON public.invitations;
CREATE POLICY invitations_select ON public.invitations
  FOR SELECT TO authenticated
  USING (
    public.is_budget_owner(budget_id, auth.uid())
    OR email = (SELECT email FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS invitations_insert_owner ON public.invitations;
CREATE POLICY invitations_insert_owner ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = auth.uid() AND public.is_budget_owner(budget_id, auth.uid())
  );

DROP POLICY IF EXISTS invitations_update ON public.invitations;
CREATE POLICY invitations_update ON public.invitations
  FOR UPDATE TO authenticated
  USING (
    public.is_budget_owner(budget_id, auth.uid())
    OR email = (SELECT email FROM public.users WHERE id = auth.uid())
  )
  WITH CHECK (
    public.is_budget_owner(budget_id, auth.uid())
    OR email = (SELECT email FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS invitations_delete_owner ON public.invitations;
CREATE POLICY invitations_delete_owner ON public.invitations
  FOR DELETE TO authenticated
  USING (public.is_budget_owner(budget_id, auth.uid()));

-- ----- categories -----
DROP POLICY IF EXISTS categories_select ON public.categories;
CREATE POLICY categories_select ON public.categories
  FOR SELECT TO authenticated
  USING (public.is_budget_member(budget_id, auth.uid()));

DROP POLICY IF EXISTS categories_insert ON public.categories;
CREATE POLICY categories_insert ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (public.is_budget_writer(budget_id, auth.uid()));

DROP POLICY IF EXISTS categories_update ON public.categories;
CREATE POLICY categories_update ON public.categories
  FOR UPDATE TO authenticated
  USING (public.is_budget_writer(budget_id, auth.uid()))
  WITH CHECK (public.is_budget_writer(budget_id, auth.uid()));

DROP POLICY IF EXISTS categories_delete ON public.categories;
CREATE POLICY categories_delete ON public.categories
  FOR DELETE TO authenticated
  USING (public.is_budget_writer(budget_id, auth.uid()));

-- ----- uploads -----
DROP POLICY IF EXISTS uploads_select ON public.uploads;
CREATE POLICY uploads_select ON public.uploads
  FOR SELECT TO authenticated
  USING (public.is_budget_member(budget_id, auth.uid()));

DROP POLICY IF EXISTS uploads_insert ON public.uploads;
CREATE POLICY uploads_insert ON public.uploads
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid() AND public.is_budget_writer(budget_id, auth.uid())
  );

DROP POLICY IF EXISTS uploads_update ON public.uploads;
CREATE POLICY uploads_update ON public.uploads
  FOR UPDATE TO authenticated
  USING (public.is_budget_writer(budget_id, auth.uid()))
  WITH CHECK (public.is_budget_writer(budget_id, auth.uid()));

DROP POLICY IF EXISTS uploads_delete ON public.uploads;
CREATE POLICY uploads_delete ON public.uploads
  FOR DELETE TO authenticated
  USING (public.is_budget_writer(budget_id, auth.uid()));

-- ----- transactions -----
DROP POLICY IF EXISTS transactions_select ON public.transactions;
CREATE POLICY transactions_select ON public.transactions
  FOR SELECT TO authenticated
  USING (public.is_budget_member(budget_id, auth.uid()));

DROP POLICY IF EXISTS transactions_insert ON public.transactions;
CREATE POLICY transactions_insert ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_budget_writer(budget_id, auth.uid()));

DROP POLICY IF EXISTS transactions_update ON public.transactions;
CREATE POLICY transactions_update ON public.transactions
  FOR UPDATE TO authenticated
  USING (public.is_budget_writer(budget_id, auth.uid()))
  WITH CHECK (public.is_budget_writer(budget_id, auth.uid()));

DROP POLICY IF EXISTS transactions_delete ON public.transactions;
CREATE POLICY transactions_delete ON public.transactions
  FOR DELETE TO authenticated
  USING (public.is_budget_writer(budget_id, auth.uid()));

-- ----- column_mappings -----
DROP POLICY IF EXISTS column_mappings_all ON public.column_mappings;
CREATE POLICY column_mappings_all ON public.column_mappings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =============================================================
-- 9. DEBUG HELPER — echo auth.uid() as seen by the current JWT
-- SECURITY INVOKER so it evaluates in the caller's auth context.
-- Safe to keep in production; it only returns the caller's own UID.
-- =============================================================
CREATE OR REPLACE FUNCTION public.current_user_uid()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_user_uid() TO authenticated, anon;

-- Debug RPC: returns who the DB thinks the caller is. Useful to confirm the
-- JWT is arriving as 'authenticated' role, not 'anon' or 'service_role'.
CREATE OR REPLACE FUNCTION public.debug_session_info()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'current_user', current_user,
    'session_user', session_user,
    'auth_uid', auth.uid(),
    'auth_role', auth.role(),
    'jwt_sub', (auth.jwt() ->> 'sub'),
    'jwt_role', (auth.jwt() ->> 'role')
  );
$$;
GRANT EXECUTE ON FUNCTION public.debug_session_info() TO authenticated, anon;

-- Debug RPC: tries the budgets INSERT from *inside* the DB as the caller.
-- If this works but a client-side insert fails, the JS client is sending the
-- request as the wrong role. If this also fails with 42501, the policy or
-- grants are wrong.
CREATE OR REPLACE FUNCTION public.debug_try_insert_budget()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.budgets (name, type, owner_id)
  VALUES ('__debug__', 'personal', auth.uid())
  RETURNING id INTO new_id;

  -- cleanup immediately
  DELETE FROM public.budgets WHERE id = new_id;

  RETURN jsonb_build_object('ok', true, 'inserted_id', new_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.debug_try_insert_budget() TO authenticated;

-- ----- users (replace select policy to include budget peers) -----
DROP POLICY IF EXISTS users_select_own ON public.users;
DROP POLICY IF EXISTS users_select_peers ON public.users;
CREATE POLICY users_select_peers ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.are_budget_peers(auth.uid(), id));
