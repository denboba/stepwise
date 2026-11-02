// Plans and billing. Shows the server-decided plan; every button calls a server function, and payment
// happens on Stripe-hosted pages (test mode).
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { beginCheckout, billingPortal, getBilling } from "@/lib/billing/billing.functions";
import { isPaidPlan, type Plan } from "@/lib/billing/plans";

const STATUS_TEXT: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment failed: on Free until it's fixed",
  unpaid: "Unpaid: on Free",
  canceled: "Cancelled",
  incomplete: "Payment not completed",
  incomplete_expired: "Payment not completed",
  paused: "Paused",
};

export function BillingPage({ checkout }: { checkout?: string | undefined }) {
  const getFn = useServerFn(getBilling);
  const checkoutFn = useServerFn(beginCheckout);
  const portalFn = useServerFn(billingPortal);
  const q = useQuery({
    queryKey: ["billing"],
    queryFn: () => getFn(),
    // After returning from Checkout the webhook may land a moment later.
    refetchInterval: (query) =>
      checkout === "success" && query.state.data?.entitlement.source !== "subscription"
        ? 3000
        : false,
  });
  const [busy, setBusy] = useState<string | null>(null);

  const go = async (
    key: string,
    fn: () => Promise<{ ok: true; url: string } | { ok: false; reason: string }>,
  ) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r.ok) window.location.assign(r.url);
      else toast(r.reason);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't reach billing. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const data = q.data;
  const ent = data?.entitlement;
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-4" /> Back to goals
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Plans and billing</h1>
      <p
        role="note"
        className="rounded-xl border border-warning/50 bg-warning/15 px-4 py-3 text-sm"
      >
        Test mode: no real payments. Prices and AI credit allowances are provisional. Credit limits,
        Smart routing and premium models are not active yet.
      </p>
      {checkout === "success" && ent?.source !== "subscription" && (
        <p role="status" className="text-sm text-muted-foreground">
          Payment received. Waiting for Stripe to confirm your plan…
        </p>
      )}
      {checkout === "cancelled" && (
        <p role="status" className="text-sm text-muted-foreground">
          Checkout cancelled. Nothing was charged.
        </p>
      )}
      {q.isLoading ? (
        <div className="shimmer h-40 rounded-2xl" aria-busy="true" />
      ) : q.isError || !data || !ent ? (
        <div className="text-sm">
          Couldn't load billing.{" "}
          <Button variant="link" className="h-auto p-0" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <section aria-label="Current plan" className="rounded-2xl border bg-card p-4 text-sm">
            <div className="font-semibold">
              Current plan: {data.plans.find((p) => p.id === ent.plan)?.name}
            </div>
            {ent.status && (
              <div className="text-muted-foreground">{STATUS_TEXT[ent.status] ?? ent.status}</div>
            )}
            {ent.cancelAtPeriodEnd && ent.currentPeriodEnd && (
              <div className="text-muted-foreground">
                Ends on {new Date(ent.currentPeriodEnd).toLocaleDateString()}
              </div>
            )}
            {data.hasCustomer && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={!!busy || !data.configured}
                onClick={() => go("portal", () => portalFn())}
              >
                {busy === "portal" && <Loader2 className="size-4 animate-spin" />} Manage billing
              </Button>
            )}
          </section>
          {(!data.configured || !data.ready) && (
            <p className="text-sm text-muted-foreground">
              Billing isn't configured on this server yet, so plans can't be purchased.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            {data.plans.map((p: Plan) => {
              const current = p.id === ent.plan;
              const canBuy =
                isPaidPlan(p.id) && ent.source !== "subscription" && data.configured && data.ready;
              return (
                <section
                  key={p.id}
                  aria-label={`${p.name} plan`}
                  className={cn(
                    "flex flex-col gap-3 rounded-2xl border bg-card p-5",
                    current && "border-primary",
                  )}
                >
                  <div>
                    <h2 className="text-lg font-semibold">{p.name}</h2>
                    <div className="text-2xl font-semibold">
                      ${p.priceUsdMonthly}
                      <span className="text-sm font-normal text-muted-foreground">/month</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{p.blurb}</p>
                  </div>
                  <ul className="space-y-1 text-sm">
                    <li>{p.monthlyCredits.toLocaleString()} AI credits a month (planned)</li>
                    <li>Routing: {p.routingModes.join(", ")} (planned)</li>
                    {p.premiumModels && <li>Premium models (planned)</li>}
                  </ul>
                  <div className="mt-auto">
                    {current ? (
                      <span className="inline-flex items-center gap-1 text-sm font-medium">
                        <Check className="size-4" /> Your plan
                      </span>
                    ) : isPaidPlan(p.id) ? (
                      <Button
                        className="w-full"
                        disabled={!canBuy || !!busy}
                        onClick={() => {
                          const plan = p.id;
                          if (isPaidPlan(plan)) void go(plan, () => checkoutFn({ data: { plan } }));
                        }}
                      >
                        {busy === p.id && <Loader2 className="size-4 animate-spin" />} Choose{" "}
                        {p.name}
                      </Button>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
