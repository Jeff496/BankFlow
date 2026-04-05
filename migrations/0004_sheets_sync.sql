-- Migration 0004: add sync lock column + last-synced timestamp to budgets
-- Idempotent. Applied ad-hoc via supabase CLI / dashboard SQL editor.

-- ==========================================================================
-- Sync lock: we can't use pg_advisory_lock via PostgREST because connections
-- rotate per-request. Instead, budgets gains two columns:
--   sync_started_at: set to now() when a sync begins, cleared on completion.
--   sheet_last_synced_at: set to the completion time of the last successful
--                         sync (for UI "last synced N minutes ago" display).
-- Acquire lock: UPDATE budgets SET sync_started_at = now() WHERE id = X AND
--   (sync_started_at IS NULL OR sync_started_at < now() - interval '5 min')
--   RETURNING id. Zero rows = another sync in progress.
-- Release lock: UPDATE budgets SET sync_started_at = NULL, sheet_last_synced_at
--   = now() WHERE id = X.
-- 5-min TTL covers crashes / server timeouts.
-- ==========================================================================

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS sync_started_at      timestamptz,
  ADD COLUMN IF NOT EXISTS sheet_last_synced_at timestamptz;
