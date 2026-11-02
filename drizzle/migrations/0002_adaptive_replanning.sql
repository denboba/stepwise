ALTER TABLE public.goals ADD COLUMN replan_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.goals ADD COLUMN paused boolean NOT NULL DEFAULT false;
ALTER TABLE public.goal_steps ADD COLUMN stuck_count integer NOT NULL DEFAULT 0;

CREATE TABLE public.plan_patches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  patch jsonb NOT NULL,
  summary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','kept')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plan_patches TO authenticated;
GRANT ALL ON public.plan_patches TO service_role;
ALTER TABLE public.plan_patches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own plan patches" ON public.plan_patches FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.plan_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  patch_id uuid REFERENCES public.plan_patches(id) ON DELETE SET NULL,
  plan jsonb NOT NULL,
  restored boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plan_revisions TO authenticated;
GRANT ALL ON public.plan_revisions TO service_role;
ALTER TABLE public.plan_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own plan revisions" ON public.plan_revisions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX plan_patches_goal_idx ON public.plan_patches(goal_id);
CREATE INDEX plan_revisions_goal_idx ON public.plan_revisions(goal_id);