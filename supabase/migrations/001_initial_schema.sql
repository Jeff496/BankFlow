-- BankFlow: Complete initial database schema
-- Enums, tables, indexes, RLS policies, triggers

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE budget_type AS ENUM ('personal', 'group');
CREATE TYPE member_role AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined');
CREATE TYPE upload_status AS ENUM ('processing', 'complete', 'failed');

-- =============================================================================
-- TABLES
-- =============================================================================

-- 1. users (profile table extending auth.users)
CREATE TABLE users (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. budgets
CREATE TABLE budgets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        budget_type NOT NULL DEFAULT 'personal',
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sheet_id    text,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. budget_members
CREATE TABLE budget_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      member_role NOT NULL DEFAULT 'viewer',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, user_id)
);

-- 4. invitations
CREATE TABLE invitations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id  uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  status     invitation_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

-- 5. categories
CREATE TABLE categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id     uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  name          text NOT NULL,
  monthly_limit decimal,
  keywords      text[] DEFAULT '{}',
  color         text NOT NULL DEFAULT '#6B7280',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 6. uploads
CREATE TABLE uploads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    text NOT NULL,
  row_count   integer NOT NULL DEFAULT 0,
  status      upload_status NOT NULL DEFAULT 'processing',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 7. transactions
CREATE TABLE transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  upload_id   uuid NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        date NOT NULL,
  description text NOT NULL,
  amount      decimal NOT NULL,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  hash        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 8. column_mappings
CREATE TABLE column_mappings (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  mapping   jsonb NOT NULL DEFAULT '{}'
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX idx_transactions_budget_date ON transactions(budget_id, date);
CREATE INDEX idx_transactions_budget_category ON transactions(budget_id, category_id);
CREATE INDEX idx_transactions_upload ON transactions(upload_id);
CREATE INDEX idx_transactions_hash_budget ON transactions(hash, budget_id);
CREATE INDEX idx_invitations_email_status ON invitations(email, status);

-- =============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_budgets_updated_at
  BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- AUTO-INSERT USER PROFILE ON SIGNUP
-- =============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE column_mappings ENABLE ROW LEVEL SECURITY;

-- Helper: check if user is a member of a budget (any role)
CREATE OR REPLACE FUNCTION is_budget_member(p_budget_id uuid, p_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM budget_members
    WHERE budget_id = p_budget_id AND user_id = p_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if user is owner or editor of a budget
CREATE OR REPLACE FUNCTION is_budget_editor(p_budget_id uuid, p_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM budget_members
    WHERE budget_id = p_budget_id AND user_id = p_user_id AND role IN ('owner', 'editor')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if user is owner of a budget
CREATE OR REPLACE FUNCTION is_budget_owner(p_budget_id uuid, p_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM budget_members
    WHERE budget_id = p_budget_id AND user_id = p_user_id AND role = 'owner'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---- users ----
CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- ---- budgets ----
CREATE POLICY "Users can read their budgets"
  ON budgets FOR SELECT
  USING (is_budget_member(id, auth.uid()));

CREATE POLICY "Users can create budgets"
  ON budgets FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update their budgets"
  ON budgets FOR UPDATE
  USING (is_budget_owner(id, auth.uid()));

CREATE POLICY "Owners can delete their budgets"
  ON budgets FOR DELETE
  USING (is_budget_owner(id, auth.uid()));

-- ---- budget_members ----
CREATE POLICY "Members can read budget members"
  ON budget_members FOR SELECT
  USING (is_budget_member(budget_id, auth.uid()));

CREATE POLICY "Owners can insert budget members"
  ON budget_members FOR INSERT
  WITH CHECK (is_budget_owner(budget_id, auth.uid()));

CREATE POLICY "Owners can update budget members"
  ON budget_members FOR UPDATE
  USING (is_budget_owner(budget_id, auth.uid()));

CREATE POLICY "Owners can delete budget members"
  ON budget_members FOR DELETE
  USING (is_budget_owner(budget_id, auth.uid()));

-- ---- invitations ----
CREATE POLICY "Inviters can create invitations"
  ON invitations FOR INSERT
  WITH CHECK (auth.uid() = invited_by);

CREATE POLICY "Invitees can read their invitations"
  ON invitations FOR SELECT
  USING (
    auth.uid() = invited_by
    OR email = (SELECT email FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Invitees can update their invitations"
  ON invitations FOR UPDATE
  USING (email = (SELECT email FROM users WHERE id = auth.uid()));

-- ---- categories ----
CREATE POLICY "Members can read categories"
  ON categories FOR SELECT
  USING (is_budget_member(budget_id, auth.uid()));

CREATE POLICY "Editors can insert categories"
  ON categories FOR INSERT
  WITH CHECK (is_budget_editor(budget_id, auth.uid()));

CREATE POLICY "Editors can update categories"
  ON categories FOR UPDATE
  USING (is_budget_editor(budget_id, auth.uid()));

CREATE POLICY "Editors can delete categories"
  ON categories FOR DELETE
  USING (is_budget_editor(budget_id, auth.uid()));

-- ---- uploads ----
CREATE POLICY "Members can read uploads"
  ON uploads FOR SELECT
  USING (is_budget_member(budget_id, auth.uid()));

CREATE POLICY "Editors can insert uploads"
  ON uploads FOR INSERT
  WITH CHECK (is_budget_editor(budget_id, auth.uid()));

CREATE POLICY "Editors can delete uploads"
  ON uploads FOR DELETE
  USING (is_budget_editor(budget_id, auth.uid()));

-- ---- transactions ----
CREATE POLICY "Members can read transactions"
  ON transactions FOR SELECT
  USING (is_budget_member(budget_id, auth.uid()));

CREATE POLICY "Editors can insert transactions"
  ON transactions FOR INSERT
  WITH CHECK (is_budget_editor(budget_id, auth.uid()));

CREATE POLICY "Editors can update transactions"
  ON transactions FOR UPDATE
  USING (is_budget_editor(budget_id, auth.uid()));

CREATE POLICY "Editors can delete transactions"
  ON transactions FOR DELETE
  USING (is_budget_editor(budget_id, auth.uid()));

-- ---- column_mappings ----
CREATE POLICY "Users can read own mappings"
  ON column_mappings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mappings"
  ON column_mappings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mappings"
  ON column_mappings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mappings"
  ON column_mappings FOR DELETE
  USING (auth.uid() = user_id);
