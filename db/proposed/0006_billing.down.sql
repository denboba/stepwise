-- Rollback for 0006_billing. The app treats missing billing tables as "everyone is on Free".
-- Export first if needed: SELECT * FROM public.subscriptions; SELECT * FROM public.billing_customers;
DROP FUNCTION IF EXISTS public.apply_subscription_event(text, bigint, uuid, text, text, text, text, text, timestamptz, boolean);
DROP TABLE IF EXISTS public.stripe_events;
DROP TABLE IF EXISTS public.subscriptions;
DROP TABLE IF EXISTS public.billing_customers;
