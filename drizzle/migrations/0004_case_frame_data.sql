ALTER TABLE public.goals ADD COLUMN case_data jsonb;
COMMENT ON COLUMN public.goals.case_data IS 'Case method state: frame, setup answers, brief, escalation. Written only by server functions.';