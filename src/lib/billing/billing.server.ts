// Server-only billing logic. Entitlements are decided here from rows only the server can write.
// Clients, Stripe and the clock are parameters so tests run on real Postgres with a fake Stripe.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  PLANS,
  entitlementFor,
  type Entitlement,
  type PaidPlanId,
  type SubscriptionRow,
} from "./plans";
import {
  planForPrice,
  verifyStripeSignature,
  type StripeConfig,
  type StripePort,
} from "./stripe.server";

// Billing tables aren't in the generated types until Lovable applies db/proposed/0006_billing.sql,
// so billing queries use the untyped client view.
type AnyDb = SupabaseClient;
type Db = SupabaseClient<Database>;
const raw = (db: Db | AnyDb) => db as unknown as AnyDb;

/** Postgres/PostgREST errors meaning "the billing tables don't exist yet". */
const MISSING_TABLE = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);
const missing = (e: { code?: string } | null) => !!e?.code && MISSING_TABLE.has(e.code);

// ---------------------------------------------------------------- entitlements

export interface BillingState {
  entitlement: Entitlement;
  /** False until the billing migration is applied. */
  ready: boolean;
  hasCustomer: boolean;
}

/** The signed-in user's entitlement, read through RLS (a user can only ever see their own row). */
export async function loadBilling(userDb: Db, userId: string, now: number): Promise<BillingState> {
  const sub = await raw(userDb)
    .from("subscriptions")
    .select("plan,status,current_period_end,cancel_at_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (missing(sub.error))
    return { entitlement: entitlementFor(null, now), ready: false, hasCustomer: false };
  if (sub.error) throw sub.error;
  const cust = await raw(userDb)
    .from("billing_customers")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (cust.error && !missing(cust.error)) throw cust.error;
  return {
    entitlement: entitlementFor((sub.data as SubscriptionRow | null) ?? null, now),
    ready: true,
    hasCustomer: !!cust.data,
  };
}

// ---------------------------------------------------------------- checkout and portal

export interface BillingDeps {
  userDb: Db;
  admin: Db;
  userId: string;
  email?: string | undefined;
  stripe: StripePort;
  config: StripeConfig;
  appUrl: string;
  now: () => number;
}

export type UrlResult = { ok: true; url: string } | { ok: false; reason: string };

const STRIPE_HOSTS = /^https:\/\/(checkout|billing)\.stripe\.com\//;

/** The user's Stripe customer id, creating the customer once. Mapping is written by the server only. */
async function customerFor(d: BillingDeps): Promise<string> {
  const read = () =>
    raw(d.admin)
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", d.userId)
      .maybeSingle();
  const found = await read();
  if (found.error) throw found.error;
  if (found.data) return String((found.data as { stripe_customer_id: string }).stripe_customer_id);
  const created = await d.stripe.createCustomer({ email: d.email, userId: d.userId });
  const ins = await raw(d.admin)
    .from("billing_customers")
    .insert({ user_id: d.userId, stripe_customer_id: created.id });
  if (ins.error?.code === "23505") {
    // Two tabs raced; keep the mapping that won (Stripe idempotency returns the same customer).
    const again = await read();
    if (again.error || !again.data) throw again.error ?? new Error("customer mapping missing");
    return String((again.data as { stripe_customer_id: string }).stripe_customer_id);
  }
  if (ins.error) throw ins.error;
  return created.id;
}

/** Starts Stripe Checkout for a paid plan. The price comes from server config, never from the client. */
export async function startCheckout(d: BillingDeps, plan: PaidPlanId): Promise<UrlResult> {
  const state = await loadBilling(d.userDb, d.userId, d.now());
  if (!state.ready) return { ok: false, reason: "Billing isn't set up yet." };
  if (state.entitlement.source === "subscription")
    return { ok: false, reason: "You already have a plan. Use Manage billing to change it." };
  const customer = await customerFor(d);
  const session = await d.stripe.createCheckoutSession({
    customer,
    price: d.config.prices[plan],
    userId: d.userId,
    plan,
    successUrl: `${d.appUrl}/billing?checkout=success`,
    cancelUrl: `${d.appUrl}/billing?checkout=cancelled`,
  });
  if (!STRIPE_HOSTS.test(session.url)) throw new Error("Unexpected checkout URL");
  return { ok: true, url: session.url };
}

export async function openPortal(d: BillingDeps): Promise<UrlResult> {
  const found = await raw(d.admin)
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", d.userId)
    .maybeSingle();
  if (missing(found.error)) return { ok: false, reason: "Billing isn't set up yet." };
  if (found.error) throw found.error;
  if (!found.data) return { ok: false, reason: "No billing account yet. Choose a plan first." };
  const session = await d.stripe.createPortalSession({
    customer: String((found.data as { stripe_customer_id: string }).stripe_customer_id),
    returnUrl: `${d.appUrl}/billing`,
  });
  if (!STRIPE_HOSTS.test(session.url)) throw new Error("Unexpected portal URL");
  return { ok: true, url: session.url };
}

// ---------------------------------------------------------------- webhooks

interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}
type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const idOf = (v: unknown) => str(v) ?? str((v as Obj | null)?.["id"]);

export type WebhookOutcome = "applied" | "stale" | "ignored" | "duplicate" | "linked";
export interface WebhookResult {
  status: number;
  outcome?: WebhookOutcome;
  error?: string;
}

/**
 * Verifies and applies one Stripe webhook. Idempotent: duplicates are skipped by event id, and every
 * write is itself safe to repeat (event-time ordering guard in apply_subscription_event), so a retry after
 * a crash re-applies cleanly. Returns 5xx on internal errors so Stripe retries.
 */
export async function handleStripeWebhook(
  admin: Db,
  cfg: StripeConfig,
  payload: string,
  signature: string | null,
  nowMs: number,
): Promise<WebhookResult> {
  if (
    !(await verifyStripeSignature(payload, signature, cfg.webhookSecret, Math.floor(nowMs / 1000)))
  )
    return { status: 400, error: "Invalid signature" };
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return { status: 400, error: "Invalid payload" };
  }
  if (!str(event.id) || !str(event.type) || typeof event.created !== "number")
    return { status: 400, error: "Invalid event" };

  const db = raw(admin);
  const seen = await db.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen.error) return { status: 500, error: "Billing storage unavailable" };
  if (seen.data) return { status: 200, outcome: "duplicate" };

  let outcome: WebhookOutcome;
  try {
    outcome = await applyEvent(db, cfg, event);
  } catch (e) {
    console.error("stripe webhook failed", event.type, e instanceof Error ? e.message : e);
    return { status: 500, error: "Processing failed" };
  }
  const rec = await db
    .from("stripe_events")
    .insert({ id: event.id, type: event.type, created: event.created, outcome });
  if (rec.error && rec.error.code !== "23505")
    return { status: 500, error: "Couldn't record event" };
  return { status: 200, outcome };
}

async function userForCustomer(db: AnyDb, customer: string | undefined): Promise<string | null> {
  if (!customer) return null;
  const r = await db
    .from("billing_customers")
    .select("user_id")
    .eq("stripe_customer_id", customer)
    .maybeSingle();
  if (r.error) throw r.error;
  return r.data ? String((r.data as { user_id: string }).user_id) : null;
}

async function applyEvent(
  db: AnyDb,
  cfg: StripeConfig,
  event: StripeEvent,
): Promise<WebhookOutcome> {
  const o = event.data.object;
  if (event.type === "checkout.session.completed") {
    // The customer was created and mapped by startCheckout; only fill in a missing mapping.
    const customer = idOf(o["customer"]);
    const userId =
      str((o["metadata"] as Obj | undefined)?.["user_id"]) ?? str(o["client_reference_id"]);
    if (!customer || !userId) return "ignored";
    const existing = await userForCustomer(db, customer);
    if (existing) return existing === userId ? "linked" : "ignored";
    const ins = await db
      .from("billing_customers")
      .insert({ user_id: userId, stripe_customer_id: customer });
    if (ins.error && ins.error.code !== "23505") throw ins.error;
    return "linked";
  }

  if (event.type.startsWith("customer.subscription.")) {
    const subId = str(o["id"]);
    const customer = idOf(o["customer"]);
    const userId = await userForCustomer(db, customer);
    const item = ((o["items"] as Obj | undefined)?.["data"] as Obj[] | undefined)?.[0];
    const priceId = idOf(item?.["price"]);
    const plan = planForPrice(cfg, priceId);
    if (!subId || !customer || !userId || !plan) return "ignored";
    const status = event.type === "customer.subscription.deleted" ? "canceled" : str(o["status"]);
    if (!status) return "ignored";
    // current_period_end moved to the subscription item in newer Stripe API versions.
    const end = Number(item?.["current_period_end"] ?? o["current_period_end"]);
    return rpc(db, {
      p_event_id: event.id,
      p_event_created: event.created,
      p_user_id: userId,
      p_customer: customer,
      p_subscription: subId,
      p_plan: plan,
      p_status: status,
      p_price: priceId ?? null,
      p_period_end: Number.isFinite(end) && end > 0 ? new Date(end * 1000).toISOString() : null,
      p_cancel_at_period_end: o["cancel_at_period_end"] === true,
    });
  }

  if (event.type === "invoice.payment_failed") {
    // Access ends right away on a failed payment; Stripe's own retries send subscription.updated later.
    const subId =
      idOf(o["subscription"]) ??
      idOf(
        ((o["parent"] as Obj | undefined)?.["subscription_details"] as Obj | undefined)?.[
          "subscription"
        ],
      );
    if (!subId) return "ignored";
    const cur = await db
      .from("subscriptions")
      .select("user_id,stripe_customer_id,plan,price_id,current_period_end,cancel_at_period_end")
      .eq("stripe_subscription_id", subId)
      .maybeSingle();
    if (cur.error) throw cur.error;
    if (!cur.data) return "ignored";
    const c = cur.data as Obj;
    return rpc(db, {
      p_event_id: event.id,
      p_event_created: event.created,
      p_user_id: c["user_id"],
      p_customer: c["stripe_customer_id"],
      p_subscription: subId,
      p_plan: c["plan"],
      p_status: "past_due",
      p_price: c["price_id"] ?? null,
      p_period_end: c["current_period_end"] ?? null,
      p_cancel_at_period_end: c["cancel_at_period_end"] === true,
    });
  }
  return "ignored";
}

async function rpc(db: AnyDb, args: Record<string, unknown>): Promise<WebhookOutcome> {
  const r = await db.rpc("apply_subscription_event", args);
  if (r.error) throw r.error;
  const out = String(r.data);
  if (out !== "applied" && out !== "stale" && out !== "ignored")
    throw new Error(`Unexpected result ${out}`);
  return out;
}

export const PUBLIC_PLANS = Object.values(PLANS);
