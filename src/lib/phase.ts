// Display-only helpers for the phase tracker and plan panel. They read goal state; they never change it.
import * as E from "./engine";
import type { Goal } from "./engine";
import type { ActivityPhase } from "./activity";

export type Phase = ActivityPhase;
export const PHASE_LABEL: Record<Phase, string> = {
  understand: "Understand",
  research: "Research",
  plan: "Plan",
  do: "Do",
  check: "Check",
};
/** Pill text on phones, e.g. "Planning · 2 of 4". */
export const PHASE_ACTIVE: Record<Phase, string> = {
  understand: "Understanding",
  research: "Researching",
  plan: "Planning",
  do: "Doing",
  check: "Checking",
};

export interface Busy {
  planning?: boolean;
  replanning?: boolean;
}

/** Research only appears for goals that actually used it. */
export function usesResearch(g: Goal): boolean {
  return g.messages.some(
    (m) => m.kind === "activity" && m.events.some((e) => e.phase === "research"),
  );
}

export function phases(g: Goal): Phase[] {
  return usesResearch(g)
    ? ["understand", "research", "plan", "do", "check"]
    : ["understand", "plan", "do", "check"];
}

/** The current phase; null once the Goal check has passed. */
export function derivePhase(g: Goal, busy: Busy = {}): Phase | null {
  if (!g.planned) return busy.planning ? "plan" : "understand";
  if (g.achieved) return null;
  if (busy.replanning) return "plan";
  if (Object.values(g.patches ?? {}).some((p) => p.status === "pending")) return "plan";
  if (!g.started) return "plan";
  const total = E.planOf(g).steps.length;
  return g.completed.length < total ? "do" : "check";
}

export type Group = "now" | "next" | "later" | "done";

/**
 * Now = available. Next = locked steps whose only missing prerequisites are available now.
 * Later = the rest of the locked steps. Done = finished.
 */
export function groupSteps(g: Goal): Record<Group, string[]> {
  const plan = E.planOf(g);
  const out: Record<Group, string[]> = { now: [], next: [], later: [], done: [] };
  for (const s of plan.steps) {
    const st = E.stepStatus(s.id, g.completed, plan);
    if (st === "done") out.done.push(s.id);
    else if (st === "available") out.now.push(s.id);
    else {
      const missing = s.prereqs.filter((r) => !g.completed.includes(r));
      const soon = missing.every((r) => E.stepStatus(r, g.completed, plan) === "available");
      out[soon ? "next" : "later"].push(s.id);
    }
  }
  return out;
}
