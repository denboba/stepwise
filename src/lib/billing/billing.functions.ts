// Authenticated billing server functions. Auth via requireSupabaseAuth; the user id comes from the
// verified token. Stripe keys and price ids stay on the server.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PUBLIC_PLANS,
  loadBilling,
  openPortal,
  startCheckout,
  type BillingDeps,
} from "./billing.server";
import { BillingNotConfigured, stripeApi, stripeConfig } from "./stripe.server";

type Ctx = { supabase: BillingDeps["userDb"]; userId: string; claims: { email?: unknown } };

async function deps(context: Ctx): Promise<BillingDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const config = stripeConfig();
  const appUrl = process.env["APP_URL"] || new URL(getRequest().url).origin;
  return {
    userDb: context.supabase,
    admin: supabaseAdmin,
    userId: context.userId,
    email: typeof context.claims.email === "string" ? context.claims.email : undefined,
    stripe: stripeApi(config),
    config,
    appUrl,
    now: () => Date.now(),
  };
}

const notConfigured = (e: unknown) =>
  e instanceof BillingNotConfigured ? { ok: false as const, reason: e.message } : null;

/** Plans plus the caller's current, server-decided entitlement. */
export const getBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const state = await loadBilling(context.supabase, context.userId, Date.now());
    let configured = true;
    try {
      stripeConfig();
    } catch {
      configured = false;
    }
    return { plans: PUBLIC_PLANS, ...state, configured, testMode: true };
  });

export const beginCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ plan: z.enum(["plus", "expert"]) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      return await startCheckout(await deps(context as Ctx), data.plan);
    } catch (e) {
      const nc = notConfigured(e);
      if (nc) return nc;
      throw e;
    }
  });

export const billingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await openPortal(await deps(context as Ctx));
    } catch (e) {
      const nc = notConfigured(e);
      if (nc) return nc;
      throw e;
    }
  });
