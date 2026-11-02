// Stripe webhook endpoint (public, unauthenticated by design: authenticity comes from the signature).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleStripeWebhook } = await import("@/lib/billing/billing.server");
        const { BillingNotConfigured, stripeConfig } = await import("@/lib/billing/stripe.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let cfg;
        try {
          cfg = stripeConfig();
        } catch (e) {
          if (e instanceof BillingNotConfigured)
            return new Response("Not configured", { status: 503 });
          throw e;
        }
        // The raw body is required for signature verification; never parse before verifying.
        const payload = await request.text();
        const res = await handleStripeWebhook(
          supabaseAdmin,
          cfg,
          payload,
          request.headers.get("stripe-signature"),
          Date.now(),
        );
        return Response.json(
          res.outcome ? { received: true, outcome: res.outcome } : { error: res.error },
          { status: res.status },
        );
      },
    },
  },
});
