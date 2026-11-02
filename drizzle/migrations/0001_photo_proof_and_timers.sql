ALTER TABLE public.goal_steps ADD COLUMN IF NOT EXISTS timer_started_at timestamptz;
ALTER TABLE public.goal_steps ADD COLUMN IF NOT EXISTS timer_done_posted boolean NOT NULL DEFAULT false;

CREATE TABLE public.photo_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step_key text NOT NULL,
  verdict text NOT NULL,
  missing_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.photo_checks TO authenticated;
GRANT ALL ON public.photo_checks TO service_role;
ALTER TABLE public.photo_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own photo checks" ON public.photo_checks FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.proof_overrides (
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  step_key text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_id, step_key)
);
GRANT SELECT ON public.proof_overrides TO authenticated;
GRANT ALL ON public.proof_overrides TO service_role;
ALTER TABLE public.proof_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own overrides" ON public.proof_overrides FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Owners read proof photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'proof-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners upload proof photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'proof-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners delete proof photos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'proof-photos' AND (storage.foldername(name))[1] = auth.uid()::text);