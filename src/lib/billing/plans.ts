// Plan definitions and entitlement rules. Pure and safe for the browser: no secrets, no Stripe ids.
// Prices and allowances are PROVISIONAL. Credits and model routing are recorded as entitlements but are
// not enforced yet (follow-up milestones); the UI must say so.

export type PlanId = "free" | "plus" | "expert";
export type PaidPlanId = Exclude<PlanId, "free">;
export type RoutingMode = "fast" | "smart" | "expert";

export interface Plan {
  id: PlanId;
  name: string;
  priceUsdMonthly: number;
  /** Monthly AI credit allowance (provisional; enforced by the future credit ledger). */
  monthlyCredits: number;
  routingModes: RoutingMode[];
  premiumModels: boolean;
  blurb: string;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsdMonthly: 0,
    monthlyCredits: 50,
    routingModes: ["fast"],
    premiumModels: false,
    blurb: "Try Stepwise on a few goals.",
  },
  plus: {
    id: "plus",
    name: "Plus",
    priceUsdMonthly: 15,
    monthlyCredits: 1000,
    routingModes: ["fast", "smart"],
    premiumModels: false,
    blurb: "For regular projects and troubleshooting.",
  },
  expert: {
    id: "expert",
    name: "Expert",
    priceUsdMonthly: 29,
    monthlyCredits: 2500,
    routingModes: ["fast", "smart", "expert"],
    premiumModels: true,
    blurb: "For demanding, long-running projects.",
  },
};

export const PAID_PLANS: PaidPlanId[] = ["plus", "expert"];

export function isPaidPlan(v: unknown): v is PaidPlanId {
  return v === "plus" || v === "expert";
}

/** Stripe subscription statuses that grant the paid plan. Everything else falls back to Free. */
export const ACCESS_STATUSES = new Set(["active", "trialing"]);

/** Days of access kept after the stored period end, in case a renewal webhook is late. */
export const PERIOD_GRACE_DAYS = 3;

/** The stored subscription row as the server reads it (user-readable through RLS, never user-writable). */
export interface SubscriptionRow {
  plan: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface Entitlement {
  plan: PlanId;
  /** Where the plan came from: a live subscription, or the Free default. */
  source: "subscription" | "default";
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  monthlyCredits: number;
  routingModes: RoutingMode[];
  premiumModels: boolean;
}

/** Server-side entitlement decision. Payment failure, cancellation and expiry all return Free. */
export function entitlementFor(sub: SubscriptionRow | null, now: number): Entitlement {
  const free = PLANS.free;
  const base = {
    status: sub?.status ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
  };
  const end = sub?.current_period_end ? Date.parse(sub.current_period_end) : null;
  const live =
    !!sub &&
    isPaidPlan(sub.plan) &&
    ACCESS_STATUSES.has(sub.status) &&
    (end === null || end + PERIOD_GRACE_DAYS * 86_400_000 > now);
  const plan = live ? PLANS[sub.plan as PaidPlanId] : free;
  return {
    plan: plan.id,
    source: live ? "subscription" : "default",
    ...base,
    monthlyCredits: plan.monthlyCredits,
    routingModes: plan.routingModes,
    premiumModels: plan.premiumModels,
  };
}
