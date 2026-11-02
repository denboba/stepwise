// Server-only Stripe access over its REST API (fetch + WebCrypto, works on Cloudflare Workers and Node).
// No SDK dependency. Test mode only: live keys are refused in this milestone.
import type { PaidPlanId } from "./plans";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  prices: Record<PaidPlanId, string>;
}

export class BillingNotConfigured extends Error {}

/** Reads Stripe settings from the private server environment. Never prefix these with VITE_. */
export function stripeConfig(env: Record<string, string | undefined> = process.env): StripeConfig {
  const secretKey = env["STRIPE_SECRET_KEY"] ?? "";
  const webhookSecret = env["STRIPE_WEBHOOK_SECRET"] ?? "";
  const plus = env["STRIPE_PRICE_PLUS"] ?? "";
  const expert = env["STRIPE_PRICE_EXPERT"] ?? "";
  if (!secretKey || !webhookSecret || !plus || !expert)
    throw new BillingNotConfigured("Billing isn't configured on this server.");
  if (!/^(sk|rk)_test_/.test(secretKey))
    throw new BillingNotConfigured(
      "Only Stripe test-mode keys are allowed until live billing is approved.",
    );
  return { secretKey, webhookSecret, prices: { plus, expert } };
}

/** Plan for a Stripe price id, from server config only (never from client input). */
export function planForPrice(cfg: StripeConfig, priceId: string | undefined): PaidPlanId | null {
  if (!priceId) return null;
  if (priceId === cfg.prices.plus) return "plus";
  if (priceId === cfg.prices.expert) return "expert";
  return null;
}

/** Stripe's form encoding, including nested objects and arrays (a[b][0][c]=…). */
export function formEncode(params: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") {
      const inner = Array.isArray(v)
        ? Object.fromEntries(v.map((x, i) => [String(i), x]))
        : (v as Record<string, unknown>);
      const s = formEncode(inner, key);
      if (s) parts.push(s);
    } else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

/** The Stripe operations Stepwise uses. Tests pass a fake. */
export interface StripePort {
  createCustomer(p: { email?: string | undefined; userId: string }): Promise<{ id: string }>;
  createCheckoutSession(p: {
    customer: string;
    price: string;
    userId: string;
    plan: PaidPlanId;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; url: string }>;
  createPortalSession(p: { customer: string; returnUrl: string }): Promise<{ url: string }>;
}

export function stripeApi(cfg: StripeConfig, fetchFn: typeof fetch = fetch): StripePort {
  const call = async <T>(
    path: string,
    params: Record<string, unknown>,
    idempotencyKey?: string,
  ) => {
    const res = await fetchFn(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: formEncode(params),
    });
    const body = (await res.json()) as T & { error?: { message?: string } };
    // Never echo the key; Stripe error messages don't contain it.
    if (!res.ok) throw new Error(`Stripe ${path} failed: ${body.error?.message ?? res.status}`);
    return body;
  };
  return {
    createCustomer: ({ email, userId }) =>
      call("customers", { email, metadata: { user_id: userId } }, `customer-${userId}`),
    createCheckoutSession: ({ customer, price, userId, plan, successUrl, cancelUrl }) =>
      call("checkout/sessions", {
        mode: "subscription",
        customer,
        client_reference_id: userId,
        line_items: [{ price, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { user_id: userId, plan },
        subscription_data: { metadata: { user_id: userId, plan } },
      }),
    createPortalSession: ({ customer, returnUrl }) =>
      call("billing_portal/sessions", { customer, return_url: returnUrl }),
  };
}

// ---------------------------------------------------------------- webhook signatures

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a `Stripe-Signature` header (t=…,v1=…) over the raw body, per Stripe's scheme.
 * Rejects timestamps outside `toleranceSec` to stop replays.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  return sigs.some((s) => safeEqual(s, expected));
}

/** Builds a valid signature header (tests and local tooling). */
export async function signStripePayload(
  payload: string,
  secret: string,
  t: number,
): Promise<string> {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${payload}`)}`;
}
