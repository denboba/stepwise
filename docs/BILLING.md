# Billing (Stripe test mode)

Status: **test mode only.** Live keys are refused in code (`stripeConfig`). The tables live in `db/proposed/0006_billing.sql` and are not applied to any Lovable database. Until they are, everyone is on Free and checkout is disabled.

## How it works

- Plans: `src/lib/billing/plans.ts`. Free $0 / Plus $15 / Expert $29. Prices and credit allowances are provisional; credits and routing are entitlements only, not enforced yet.
- Entitlements are decided on the server (`entitlementFor`) from `subscriptions`, a row users can read but never write (RLS + revoked privileges). Only `active`/`trialing` grant a paid plan. `past_due`, `unpaid`, `canceled`, `incomplete` and `paused` fall back to Free; a stale `active` row expires 3 days after its period end.
- Checkout and Portal: `beginCheckout` / `billingPortal` server functions. The price id comes from server config, never from the browser. One Stripe customer per user, created by the server.
- Webhook: `POST /api/stripe/webhook`. Verifies the signature (HMAC-SHA256, 5-minute tolerance) on the raw body, dedupes by event id, and applies subscription changes through `apply_subscription_event()` (row lock; refuses older events; an old subscription ending can't cancel a newer one). Errors return 5xx so Stripe retries.

## Configuration (private server environment; never `VITE_`)

| Name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` or restricted `rk_test_…` (customers, checkout sessions, portal sessions: write) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the webhook endpoint |
| `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_EXPERT` | Test-mode monthly recurring price ids |
| `APP_URL` (optional) | Public app origin for return URLs; defaults to the request origin |

Stripe dashboard (test mode): create the two products/prices, enable the Customer Portal, and add a webhook endpoint `https://<app>/api/stripe/webhook` with `checkout.session.completed`, `customer.subscription.created|updated|deleted` and `invoice.payment_failed`. Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## Before live billing

1. Apply `0006_billing.sql` in staging, then production, through Lovable (docs/MIGRATIONS.md). Regenerate types.
2. End-to-end test in Stripe test mode: subscribe, upgrade, cancel at period end, failed payment (card `4000 0000 0000 0341`), resend events from the dashboard.
3. Legal: terms, refund policy, tax (Stripe Tax?), and customer emails.
4. Allow live keys in `stripeConfig` (deliberate code change and review) and set live secrets.
5. Monitoring for webhook failures, plus a reconciliation job that re-reads subscriptions from Stripe.

## Follow-up milestones (not built)

- **Credit ledger and hard limits:** per-request reservation, then settlement in one transaction (no concurrent overspend); no charge for failed AI calls; monthly reset from `current_period_end`.
- **Model routing:** Fast/Smart/Expert modes behind a provider abstraction (Lovable AI Gateway first), gated by entitlement.
- **Usage reporting:** per-user credits and approximate cost from `ai_call_logs`.
- **Prepaid top-ups**, admin analytics, premium-model switching.
