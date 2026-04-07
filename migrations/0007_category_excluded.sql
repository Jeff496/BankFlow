-- Allow users to exclude entire categories from budget calculations.
-- All transactions in an excluded category are treated as excluded.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false;
