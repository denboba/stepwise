// @vitest-environment node
// Billing foundation on real Postgres (PGlite) with db/proposed/0006_billing.sql and a fake Stripe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleStripeWebhook,
  loadBilling,
  openPortal,
  startCheckout,
  type BillingDeps,
} from "@/lib/billing/billing.server";
import { signStripePayload, stripeConfig, type StripePort } from "@/lib/billing/stripe.server";
import { applyProposed, clientFor, freshDb, sqlAs, type TestDb } from "./pgClient";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.parse("2026-11-02T12:00:00Z");
const T = Math.floor(NOW / 1000);
const cfg = stripeConfig({
  STRIPE_SECRET_KEY: "sk_test_fake",
  STRIPE_WEBHOOK_SECRET: "whsec_fake",
  STRIPE_PRICE_PLUS: "price_plus",
  STRIPE_PRICE_EXPERT: "price_expert",
});
type Db = BillingDeps["userDb"];
const user = (db: TestDb, id: string) =>
  clientFor(db, { role: "authenticated", userId: id }) as unknown as Db;
const admin = (db: TestDb) => clientFor(db, { role: "service_role" }) as unknown as Db;
const service = { role: "service_role" as const };

function fakeStripe() {
  const calls: string[] = [];
  let n = 0;
  const port: StripePort = {
    createCustomer: async ({ userId }) => {
      calls.push(`customer:${userId}`);
      return { id: `cus_${userId.slice(0, 4)}` };
    },
    createCheckoutSession: async ({ customer, price, userId }) => {
      calls.push(`checkout:${customer}:${price}:${userId}`);
      return { id: `cs_${++n}`, url: `https://checkout.stripe.com/c/pay/cs_${n}` };
    },
    createPortalSession: async ({ customer }) => {
      calls.push(`portal:${customer}`);
      return { url: `https://billing.stripe.com/p/session/${customer}` };
    },
  };
  return { port, calls };
}

const deps = (db: TestDb, userId: string, stripe: StripePort): BillingDeps => ({
  userDb: user(db, userId),
  admin: admin(db),
  userId,
  email: `${userId.slice(0, 1)}@example.test`,
  stripe,
  config: cfg,
  appUrl: "https://app.example.test",
  now: () => NOW,
});

let seq = 0;
async function send(
  db: TestDb,
  type: string,
  object: Record<string, unknown>,
  created = T,
  id = `evt_${++seq}`,
) {
  const payload = JSON.stringify({ id, type, created, data: { object } });
  const sig = await signStripePayload(payload, cfg.webhookSecret, T);
  return { id, ...(await handleStripeWebhook(admin(db), cfg, payload, sig, NOW)) };
}
const subObj = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  customer: "cus_aaaa",
  status: "active",
  cancel_at_period_end: false,
  items: { data: [{ price: { id: "price_plus" }, current_period_end: T + 30 * 86400 }] },
  ...over,
});
const plan = async (db: TestDb, id = A) => (await loadBilling(user(db, id), id, NOW)).entitlement;
const rows = async (db: TestDb, sql: string) => (await sqlAs(db, service, sql)).rows;

/** A user who completed Checkout for Plus. */
async function subscribed(db: TestDb) {
  const s = fakeStripe();
  const r = await startCheckout(deps(db, A, s.port), "plus");
  expect(r.ok).toBe(true);
  await send(db, "checkout.session.completed", {
    customer: "cus_aaaa",
    client_reference_id: A,
    metadata: { user_id: A },
  });
  await send(db, "customer.subscription.created", subObj());
  return s;
}

describe("checkout and portal (fake Stripe)", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await freshDb();
    await applyProposed(db, "0006_billing.sql");
  });

  it("creates the customer once, uses the server's price, and returns a Stripe-hosted URL", async () => {
    const s = fakeStripe();
    const r1 = await startCheckout(deps(db, A, s.port), "plus");
    const r2 = await startCheckout(deps(db, A, s.port), "expert");
    expect(r1).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_1" });
    expect(r2.ok).toBe(true);
    expect(s.calls).toEqual([
      `customer:${A}`,
      `checkout:cus_aaaa:price_plus:${A}`,
      `checkout:cus_aaaa:price_expert:${A}`,
    ]);
    expect(
      await rows(db, "SELECT user_id, stripe_customer_id FROM public.billing_customers"),
    ).toEqual([{ user_id: A, stripe_customer_id: "cus_aaaa" }]);
  });

  it("an existing subscriber is sent to the portal instead of a second checkout", async () => {
    await subscribed(db);
    const s = fakeStripe();
    expect(await startCheckout(deps(db, A, s.port), "expert")).toMatchObject({ ok: false });
    expect(await openPortal(deps(db, A, s.port))).toEqual({
      ok: true,
      url: "https://billing.stripe.com/p/session/cus_aaaa",
    });
  });

  it("portal needs a billing account; another user's account is never used", async () => {
    await subscribed(db);
    const s = fakeStripe();
    expect(await openPortal(deps(db, B, s.port))).toMatchObject({ ok: false });
    expect(s.calls).toEqual([]);
  });

  it("without the billing tables everyone is Free and checkout is refused clearly", async () => {
    const bare = await freshDb();
    const st = await loadBilling(user(bare, A), A, NOW);
    expect(st).toMatchObject({ ready: false, entitlement: { plan: "free" } });
    expect(await startCheckout(deps(bare, A, fakeStripe().port), "plus")).toMatchObject({
      ok: false,
    });
  });
});

describe("webhook lifecycle", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await freshDb();
    await applyProposed(db, "0006_billing.sql");
  });

  it("a verified subscription event grants the plan", async () => {
    await subscribed(db);
    expect(await plan(db)).toMatchObject({
      plan: "plus",
      source: "subscription",
      monthlyCredits: 1000,
    });
    expect(await plan(db, B)).toMatchObject({ plan: "free" });
  });

  it("an unsigned or tampered event changes nothing", async () => {
    await subscribed(db);
    const payload = JSON.stringify({
      id: "evt_forged",
      type: "customer.subscription.updated",
      created: T + 10,
      data: { object: subObj({ items: { data: [{ price: { id: "price_expert" } }] } }) },
    });
    expect((await handleStripeWebhook(admin(db), cfg, payload, null, NOW)).status).toBe(400);
    const sig = await signStripePayload(
      payload.replace("evt_forged", "evt_x"),
      cfg.webhookSecret,
      T,
    );
    expect((await handleStripeWebhook(admin(db), cfg, payload, sig, NOW)).status).toBe(400);
    expect((await plan(db)).plan).toBe("plus");
    expect(
      await rows(db, "SELECT id FROM public.stripe_events WHERE id LIKE 'evt_forged%'"),
    ).toEqual([]);
  });

  it("a duplicate delivery is processed once", async () => {
    await subscribed(db);
    const first = await send(
      db,
      "customer.subscription.updated",
      subObj({ status: "past_due" }),
      T + 5,
      "evt_dup",
    );
    const again = await send(
      db,
      "customer.subscription.updated",
      subObj({ status: "past_due" }),
      T + 5,
      "evt_dup",
    );
    expect(first.outcome).toBe("applied");
    expect(again).toMatchObject({ status: 200, outcome: "duplicate" });
    expect(
      await rows(db, "SELECT count(*)::int AS n FROM public.stripe_events WHERE id = 'evt_dup'"),
    ).toEqual([{ n: 1 }]);
  });

  it("an older event arriving late can't undo a newer one", async () => {
    await subscribed(db);
    await send(db, "customer.subscription.deleted", subObj({ status: "canceled" }), T + 100);
    const late = await send(
      db,
      "customer.subscription.updated",
      subObj({ status: "active" }),
      T + 50,
    );
    expect(late.outcome).toBe("stale");
    expect((await plan(db)).plan).toBe("free");
  });

  it("cancellation at period end keeps access; deletion ends it", async () => {
    await subscribed(db);
    await send(db, "customer.subscription.updated", subObj({ cancel_at_period_end: true }), T + 10);
    expect(await plan(db)).toMatchObject({ plan: "plus", cancelAtPeriodEnd: true });
    await send(db, "customer.subscription.deleted", subObj({ status: "canceled" }), T + 20);
    expect(await plan(db)).toMatchObject({ plan: "free", status: "canceled" });
  });

  it("a failed payment removes access; a recovered payment restores it", async () => {
    await subscribed(db);
    await send(db, "invoice.payment_failed", { id: "in_1", subscription: "sub_1" }, T + 10);
    expect(await plan(db)).toMatchObject({ plan: "free", status: "past_due" });
    await send(db, "customer.subscription.updated", subObj({ status: "active" }), T + 20);
    expect((await plan(db)).plan).toBe("plus");
  });

  it("upgrading changes the plan from the price, not from metadata", async () => {
    await subscribed(db);
    await send(
      db,
      "customer.subscription.updated",
      subObj({
        metadata: { plan: "plus" },
        items: { data: [{ price: { id: "price_expert" }, current_period_end: T + 86400 }] },
      }),
      T + 10,
    );
    expect(await plan(db)).toMatchObject({ plan: "expert", premiumModels: true });
  });

  it("an old subscription ending doesn't cancel a newer live one", async () => {
    await subscribed(db);
    await send(db, "customer.subscription.created", subObj({ id: "sub_2" }), T + 10);
    const old = await send(
      db,
      "customer.subscription.deleted",
      subObj({ id: "sub_1", status: "canceled" }),
      T + 20,
    );
    expect(old.outcome).toBe("ignored");
    expect((await plan(db)).plan).toBe("plus");
  });

  it("unknown prices, unknown customers and unrelated events are ignored", async () => {
    await subscribed(db);
    expect(
      (
        await send(
          db,
          "customer.subscription.updated",
          subObj({ items: { data: [{ price: { id: "price_x" } }] } }),
          T + 5,
        )
      ).outcome,
    ).toBe("ignored");
    expect(
      (
        await send(
          db,
          "customer.subscription.created",
          subObj({ id: "sub_9", customer: "cus_nobody" }),
          T + 5,
        )
      ).outcome,
    ).toBe("ignored");
    expect((await send(db, "charge.refunded", { id: "ch_1" }, T + 5)).outcome).toBe("ignored");
    expect((await plan(db)).plan).toBe("plus");
  });

  it("checkout completion can't re-point another user's customer", async () => {
    await subscribed(db);
    const r = await send(db, "checkout.session.completed", {
      customer: "cus_aaaa",
      client_reference_id: B,
      metadata: { user_id: B },
    });
    expect(r.outcome).toBe("ignored");
    expect(await plan(db, B)).toMatchObject({ plan: "free" });
  });

  it("concurrent deliveries of different events leave one consistent row", async () => {
    await subscribed(db);
    await Promise.all([
      send(db, "customer.subscription.updated", subObj({ status: "past_due" }), T + 30),
      send(db, "customer.subscription.updated", subObj({ status: "active" }), T + 40),
    ]);
    expect(await rows(db, "SELECT status, last_event_created FROM public.subscriptions")).toEqual([
      { status: "active", last_event_created: T + 40 },
    ]);
  });
});

describe("authorization", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await freshDb();
    await applyProposed(db, "0006_billing.sql");
    await subscribed(db);
  });
  const asUser = (id: string, sql: string, p: unknown[] = []) =>
    sqlAs(db, { role: "authenticated", userId: id }, sql, p);

  it("users read only their own billing rows", async () => {
    expect((await asUser(A, "SELECT plan FROM public.subscriptions")).rows).toEqual([
      { plan: "plus" },
    ]);
    expect((await asUser(B, "SELECT plan FROM public.subscriptions")).rows).toEqual([]);
    expect((await asUser(B, "SELECT * FROM public.billing_customers")).rows).toEqual([]);
    expect(
      (await sqlAs(db, { role: "anon" }, "SELECT * FROM public.subscriptions")).error?.code,
    ).toBe("42501");
  });

  it("users can't grant themselves a paid plan or edit billing data", async () => {
    const tries = [
      [
        B,
        "INSERT INTO public.subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status, last_event_created, last_event_id) VALUES ($1, 'cus_b', 'sub_b', 'expert', 'active', 1, 'x')",
        [B],
      ],
      [A, "UPDATE public.subscriptions SET plan = 'expert' WHERE user_id = $1", [A]],
      [A, "DELETE FROM public.subscriptions WHERE user_id = $1", [A]],
      [
        B,
        "INSERT INTO public.billing_customers (user_id, stripe_customer_id) VALUES ($1, 'cus_b')",
        [B],
      ],
      [
        A,
        "UPDATE public.billing_customers SET stripe_customer_id = 'cus_z' WHERE user_id = $1",
        [A],
      ],
    ] as const;
    for (const [id, sql, p] of tries)
      expect((await asUser(id, sql, [...p])).error?.code, sql).toBe("42501");
    const fn = await asUser(
      B,
      "SELECT public.apply_subscription_event('e', 9999999999, $1, 'c', 's', 'expert', 'active', null, null, false)",
      [B],
    );
    expect(fn.error?.code).toBe("42501");
    expect((await asUser(A, "SELECT * FROM public.stripe_events")).error?.code).toBe("42501");
    expect(await plan(db)).toMatchObject({ plan: "plus" });
    expect(await plan(db, B)).toMatchObject({ plan: "free" });
  });

  it("the migration rolls back cleanly", async () => {
    await applyProposed(db, "0006_billing.down.sql");
    expect(
      await rows(
        db,
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('subscriptions','billing_customers','stripe_events')",
      ),
    ).toEqual([{ n: 0 }]);
    expect((await loadBilling(user(db, A), A, NOW)).ready).toBe(false);
  });

  it("the billing and lifecycle migrations apply together", async () => {
    await applyProposed(db, "0005_goal_lifecycle.sql");
    expect(await plan(db)).toMatchObject({ plan: "plus" });
  });
});
