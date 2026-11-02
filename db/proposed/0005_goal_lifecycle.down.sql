-- Rollback for 0005_goal_lifecycle. Safe at any time: the app falls back to deriving statuses from the
-- existing flags when the column is missing. Loses only recorded escalation/end reasons, so export them
-- first if needed:  SELECT id, status, status_reason, status_changed_at FROM public.goals
--                   WHERE status IN ('escalated', 'abandoned');
ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS goals_status_reason_length;
ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS goals_status_check;
ALTER TABLE public.goals
  DROP COLUMN IF EXISTS status_changed_at,
  DROP COLUMN IF EXISTS status_reason,
  DROP COLUMN IF EXISTS status;
