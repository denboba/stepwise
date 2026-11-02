import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { BillingPage } from "@/components/stepwise/Billing";

export const Route = createFileRoute("/_authenticated/billing")({
  validateSearch: (s: Record<string, unknown>) =>
    z.object({ checkout: z.enum(["success", "cancelled"]).optional() }).parse(s),
  head: () => ({ meta: [{ title: "Plans and billing · Stepwise" }] }),
  component: function Billing() {
    const { checkout } = Route.useSearch();
    return <BillingPage checkout={checkout} />;
  },
});
