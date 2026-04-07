-- Allow users to exclude transactions from budget calculations.
-- Excluded transactions are still visible but don't affect metrics.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false;
