-- 0006_billing: subscription foundation (Stripe test mode). PROPOSED: not in drizzle/migrations/, so
-- Lovable does not apply it. Independent of 0005_goal_lifecycle. Validated by src/test/db/billing.test.ts.
-- Users can read only their own billing rows; every write goes through server code with the service role.

CREATE TABLE IF NOT EXISTS public.billing_customers (
  user_id uuid PRIMARY KEY,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id uuid PRIMARY KEY,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL UNIQUE,
  plan text NOT NULL CHECK (plan IN ('plus', 'expert')),
  status text NOT NULL CHECK (status IN (
    'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'
  )),
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  -- Ordering guard: Stripe may deliver events late or out of order.
  last_event_created bigint NOT NULL,
  last_event_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Processed webhook event ids (idempotency). Not readable by users.
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  created bigint NOT NULL,
  outcome text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own billing customer" ON public.billing_customers;
CREATE POLICY "Users read own billing customer" ON public.billing_customers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users read own subscription" ON public.subscriptions;
CREATE POLICY "Users read own subscription" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Defense in depth on top of RLS: browser roles get read-only (or no) table privileges.
REVOKE ALL ON public.billing_customers, public.subscriptions, public.stripe_events FROM anon, authenticated;
GRANT SELECT ON public.billing_customers, public.subscriptions TO authenticated;
GRANT ALL ON public.billing_customers, public.subscriptions, public.stripe_events TO service_role;

-- Applies one subscription event atomically (row lock), refusing stale and cross-subscription regressions.
-- Returns 'applied', 'stale' (older than the stored event) or 'ignored' (an old subscription ending
-- must not overwrite a newer live one).
CREATE OR REPLACE FUNCTION public.apply_subscription_event(
  p_event_id text,
  p_event_created bigint,
  p_user_id uuid,
  p_customer text,
  p_subscription text,
  p_plan text,
  p_status text,
  p_price text,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cur public.subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO cur FROM public.subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.subscriptions (
      user_id, stripe_customer_id, stripe_subscription_id, plan, status, price_id,
      current_period_end, cancel_at_period_end, last_event_created, last_event_id
    ) VALUES (
      p_user_id, p_customer, p_subscription, p_plan, p_status, p_price,
      p_period_end, p_cancel_at_period_end, p_event_created, p_event_id
    ) ON CONFLICT (user_id) DO NOTHING;
    IF FOUND THEN RETURN 'applied'; END IF;
    SELECT * INTO cur FROM public.subscriptions WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  IF cur.stripe_subscription_id <> p_subscription
     AND cur.status IN ('active', 'trialing', 'past_due')
     AND p_status IN ('canceled', 'incomplete_expired', 'unpaid', 'incomplete') THEN
    RETURN 'ignored';
  END IF;
  IF cur.stripe_subscription_id = p_subscription AND p_event_created < cur.last_event_created THEN
    RETURN 'stale';
  END IF;

  UPDATE public.subscriptions SET
    stripe_customer_id = p_customer,
    stripe_subscription_id = p_subscription,
    plan = p_plan,
    status = p_status,
    price_id = p_price,
    current_period_end = p_period_end,
    cancel_at_period_end = p_cancel_at_period_end,
    last_event_created = p_event_created,
    last_event_id = p_event_id,
    updated_at = now()
  WHERE user_id = p_user_id;
  RETURN 'applied';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_subscription_event(text, bigint, uuid, text, text, text, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_event(text, bigint, uuid, text, text, text, text, text, timestamptz, boolean)
  TO service_role;
