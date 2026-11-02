-- 0005_goal_lifecycle (ADR-0001, approved as a design direction 2026-11-02).
-- PROPOSED: not in drizzle/migrations/, so Lovable does not apply it. See docs/MIGRATIONS.md for the
-- staging -> production procedure. Validated by src/test/db/lifecycle-migration.test.ts.
--
-- Additive and backward compatible: existing columns and flags are untouched and stay authoritative for
-- older code. Code from the same PR writes `status` only when this column exists.

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS goals_status_check;
ALTER TABLE public.goals ADD CONSTRAINT goals_status_check CHECK (status IN (
  'draft', 'understanding', 'active', 'waiting', 'blocked', 'paused',
  'verifying', 'unresolved', 'achieved', 'escalated', 'abandoned'
));
ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS goals_status_reason_length;
ALTER TABLE public.goals ADD CONSTRAINT goals_status_reason_length
  CHECK (status_reason IS NULL OR char_length(status_reason) <= 500);

-- Deterministic backfill, mirroring deriveStatus() in src/lib/lifecycle.ts (timers are left to the app,
-- which re-derives non-sticky statuses on every load). Only rows still at the default are touched, so
-- re-running this file never overwrites statuses written by the app.
UPDATE public.goals g
SET status = CASE
    WHEN g.achieved THEN 'achieved'
    WHEN g.paused THEN 'paused'
    WHEN NOT g.planned THEN CASE
      WHEN EXISTS (SELECT 1 FROM public.messages m WHERE m.goal_id = g.id AND m.role = 'user')
        THEN 'understanding' ELSE 'draft' END
    WHEN (SELECT m.kind FROM public.messages m WHERE m.goal_id = g.id ORDER BY m.seq DESC LIMIT 1)
      = 'replanLimit' THEN 'blocked'
    WHEN EXISTS (SELECT 1 FROM public.goal_steps s WHERE s.goal_id = g.id)
      AND NOT EXISTS (SELECT 1 FROM public.goal_steps s WHERE s.goal_id = g.id AND NOT s.done)
      THEN CASE
        WHEN (SELECT m.kind FROM public.messages m
              WHERE m.goal_id = g.id AND m.kind IN ('check', 'checkFail')
              ORDER BY m.seq DESC LIMIT 1) = 'checkFail'
          THEN 'unresolved' ELSE 'verifying' END
    ELSE 'active'
  END,
  status_changed_at = now()
WHERE g.status = 'draft' AND g.status_changed_at IS NULL;

COMMENT ON COLUMN public.goals.status IS
  'Lifecycle status (ADR-0001). Written only by server functions; escalated/abandoned are sticky.';
COMMENT ON COLUMN public.goals.status_reason IS 'User-given reason for escalated or abandoned.';

-- No policy changes: signed-in users keep read-only access to goals (plus delete), so the browser can
-- never write a status.
