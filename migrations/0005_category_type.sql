-- Add income/expense type to categories.
-- Existing categories default to 'expense'. Positive transactions (income,
-- refunds) should be routed to 'income' categories; negative transactions
-- (spending) to 'expense' categories.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'expense';

ALTER TABLE public.categories
  ADD CONSTRAINT categories_type_check CHECK (type IN ('expense', 'income'));
