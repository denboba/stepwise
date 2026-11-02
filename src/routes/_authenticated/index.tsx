import { createFileRoute } from "@tanstack/react-router";
import { StepwiseApp } from "@/components/stepwise/App";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Stepwise: one step at a time, with proof" },
      {
        name: "description",
        content:
          "Get a real-world job done step by step. Each step needs proof before you move on.",
      },
      { property: "og:title", content: "Stepwise: one step at a time, with proof" },
      {
        property: "og:description",
        content:
          "Get a real-world job done step by step. Each step needs proof before you move on.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StepwiseApp,
});
