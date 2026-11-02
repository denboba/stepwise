CREATE TABLE public.plan_templates (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plan_templates TO authenticated;
GRANT ALL ON public.plan_templates TO service_role;
ALTER TABLE public.plan_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read templates" ON public.plan_templates FOR SELECT TO authenticated USING (true);

CREATE TABLE public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  template_id text REFERENCES public.plan_templates(id),
  title text,
  goal_text text,
  done_means text,
  check_def jsonb,
  planned boolean NOT NULL DEFAULT false,
  started boolean NOT NULL DEFAULT false,
  achieved boolean NOT NULL DEFAULT false,
  seq integer NOT NULL DEFAULT 0,
  custom boolean NOT NULL DEFAULT false,
  intake jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goals_user_idx ON public.goals(user_id, created_at DESC);
GRANT SELECT, DELETE ON public.goals TO authenticated;
GRANT ALL ON public.goals TO service_role;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own goals" ON public.goals FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own goals" ON public.goals FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.goal_steps (
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step_key text NOT NULL,
  position integer NOT NULL,
  title text NOT NULL,
  minutes integer NOT NULL,
  safety text,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  hint text NOT NULL DEFAULT '',
  why text NOT NULL DEFAULT '',
  recap text,
  acknowledged boolean NOT NULL DEFAULT false,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  wait_seconds integer,
  PRIMARY KEY (goal_id, step_key)
);
GRANT SELECT ON public.goal_steps TO authenticated;
GRANT ALL ON public.goal_steps TO service_role;
ALTER TABLE public.goal_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own steps" ON public.goal_steps FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.step_prereqs (
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step_key text NOT NULL,
  prereq_key text NOT NULL,
  PRIMARY KEY (goal_id, step_key, prereq_key)
);
GRANT SELECT ON public.step_prereqs TO authenticated;
GRANT ALL ON public.step_prereqs TO service_role;
ALTER TABLE public.step_prereqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own prereqs" ON public.step_prereqs FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.proof_items (
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step_key text NOT NULL,
  item_key text NOT NULL,
  position integer NOT NULL,
  label text NOT NULL,
  kind text NOT NULL,
  min_value numeric,
  max_value numeric,
  PRIMARY KEY (goal_id, step_key, item_key)
);
GRANT SELECT ON public.proof_items TO authenticated;
GRANT ALL ON public.proof_items TO service_role;
ALTER TABLE public.proof_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own proof items" ON public.proof_items FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.proof_submissions (
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step_key text NOT NULL,
  item_key text NOT NULL,
  value jsonb NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_id, step_key, item_key)
);
GRANT SELECT ON public.proof_submissions TO authenticated;
GRANT ALL ON public.proof_submissions TO service_role;
ALTER TABLE public.proof_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own proof" ON public.proof_submissions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.goal_check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  passed boolean NOT NULL,
  answers jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goal_check_results_goal_idx ON public.goal_check_results(goal_id);
GRANT SELECT ON public.goal_check_results TO authenticated;
GRANT ALL ON public.goal_check_results TO service_role;
ALTER TABLE public.goal_check_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own check results" ON public.goal_check_results FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.messages (
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  seq integer NOT NULL,
  role text NOT NULL,
  kind text NOT NULL,
  body text,
  step_ids jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_id, seq)
);
GRANT SELECT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own messages" ON public.messages FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.custom_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  goal_id uuid NOT NULL UNIQUE REFERENCES public.goals(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.custom_plans TO authenticated;
GRANT ALL ON public.custom_plans TO service_role;
ALTER TABLE public.custom_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own custom plans" ON public.custom_plans FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.ai_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  goal_id uuid REFERENCES public.goals(id) ON DELETE CASCADE,
  mode text NOT NULL,
  model text NOT NULL,
  ok boolean NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_call_logs TO authenticated;
GRANT ALL ON public.ai_call_logs TO service_role;
ALTER TABLE public.ai_call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own AI call logs" ON public.ai_call_logs FOR SELECT TO authenticated USING (user_id = auth.uid());

INSERT INTO public.plan_templates (id, data) VALUES
('phone', '{"id":"phone"}'::jsonb),
('website', '{"id":"website"}'::jsonb),
('robot', '{"id":"robot"}'::jsonb);