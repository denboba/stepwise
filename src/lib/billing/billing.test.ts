import { describe, expect, it } from "vitest";
import { PLANS, entitlementFor } from "./plans";
import {
  BillingNotConfigured,
  formEncode,
  planForPrice,
  signStripePayload,
  stripeConfig,
  verifyStripeSignature,
} from "./stripe.server";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const sub = (over: Partial<Parameters<typeof entitlementFor>[0] & object> = {}) => ({
  plan: "plus",
  status: "active",
  current_period_end: "2026-12-02T12:00:00Z",
  cancel_at_period_end: false,
  ...over,
});

describe("entitlements", () => {
  it("no subscription is Free", () => {
    expect(entitlementFor(null, NOW)).toMatchObject({
      plan: "free",
      source: "default",
      monthlyCredits: 50,
    });
  });
  it("active or trialing grants the plan", () => {
    expect(entitlementFor(sub(), NOW)).toMatchObject({
      plan: "plus",
      source: "subscription",
      monthlyCredits: 1000,
    });
    expect(entitlementFor(sub({ plan: "expert", status: "trialing" }), NOW)).toMatchObject({
      plan: "expert",
      premiumModels: true,
    });
  });
  it.each(["past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"])(
    "%s falls back to Free",
    (status) => {
      expect(entitlementFor(sub({ status }), NOW).plan).toBe("free");
    },
  );
  it("cancel at period end keeps access until the period ends", () => {
    expect(entitlementFor(sub({ cancel_at_period_end: true }), NOW)).toMatchObject({
      plan: "plus",
      cancelAtPeriodEnd: true,
    });
  });
  it("an active row long past its period end (missed webhook) is Free after the grace period", () => {
    expect(entitlementFor(sub({ current_period_end: "2026-10-31T12:00:00Z" }), NOW).plan).toBe(
      "plus",
    );
    expect(entitlementFor(sub({ current_period_end: "2026-10-20T12:00:00Z" }), NOW).plan).toBe(
      "free",
    );
  });
  it("an unknown plan never grants access", () => {
    expect(entitlementFor(sub({ plan: "free" }), NOW).plan).toBe("free");
    expect(entitlementFor(sub({ plan: "unlimited" }), NOW).plan).toBe("free");
  });
  it("plans are provisional and finite", () => {
    expect(Object.values(PLANS).map((p) => p.priceUsdMonthly)).toEqual([0, 15, 29]);
    for (const p of Object.values(PLANS)) expect(Number.isFinite(p.monthlyCredits)).toBe(true);
  });
});

describe("Stripe config", () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_PLUS: "price_plus",
    STRIPE_PRICE_EXPERT: "price_expert",
  };
  it("accepts test keys and maps prices to plans", () => {
    const cfg = stripeConfig(env);
    expect(planForPrice(cfg, "price_plus")).toBe("plus");
    expect(planForPrice(cfg, "price_expert")).toBe("expert");
    expect(planForPrice(cfg, "price_other")).toBeNull();
  });
  it("refuses live keys and missing settings", () => {
    expect(() => stripeConfig({ ...env, STRIPE_SECRET_KEY: "sk_live_x" })).toThrow(
      BillingNotConfigured,
    );
    expect(() => stripeConfig({ ...env, STRIPE_WEBHOOK_SECRET: "" })).toThrow(BillingNotConfigured);
  });
  it("form-encodes nested params the way Stripe expects", () => {
    expect(
      decodeURIComponent(
        formEncode({
          mode: "subscription",
          line_items: [{ price: "p", quantity: 1 }],
          metadata: { user_id: "u" },
        }),
      ),
    ).toBe(
      "mode=subscription&line_items[0][price]=p&line_items[0][quantity]=1&metadata[user_id]=u",
    );
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1"}';
  const t = 1_793_000_000;
  it("accepts a valid signature", async () => {
    expect(
      await verifyStripeSignature(body, await signStripePayload(body, secret, t), secret, t),
    ).toBe(true);
  });
  it("accepts when one of several v1 signatures matches (secret rotation)", async () => {
    const good = (await signStripePayload(body, secret, t)).split("v1=")[1];
    expect(await verifyStripeSignature(body, `t=${t},v1=deadbeef,v1=${good}`, secret, t)).toBe(
      true,
    );
  });
  it("rejects a tampered body, wrong secret, old timestamp or missing header", async () => {
    const h = await signStripePayload(body, secret, t);
    expect(await verifyStripeSignature('{"id":"evt_2"}', h, secret, t)).toBe(false);
    expect(await verifyStripeSignature(body, h, "whsec_other", t)).toBe(false);
    expect(await verifyStripeSignature(body, h, secret, t + 301)).toBe(false);
    expect(await verifyStripeSignature(body, null, secret, t)).toBe(false);
    expect(await verifyStripeSignature(body, "garbage", secret, t)).toBe(false);
  });
});
