// Goal lifecycle (ADR-0001). Pure and deterministic: the server decides a goal's status from persisted
// state plus explicit user/safety events; AI output never sets a status.
//
// Most statuses are DERIVED from what is already stored (flags, steps, timers, messages), so they can't
// drift from the real state. Two are STICKY and only change through explicit, validated events:
//   escalated  (life-safety stop or "get professional help"; cleared only by the user confirming safety)
//   abandoned  (the user ended the goal with a reason; final)
// `achieved` is only reachable through a passed Goal check, so finishing the checklist is never success.
import * as E from "./engine";
import type { Goal } from "./engine";

export const GOAL_STATUSES = [
  "draft",
  "understanding",
  "active",
  "waiting",
  "blocked",
  "paused",
  "verifying",
  "unresolved",
  "achieved",
  "escalated",
  "abandoned",
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const STATUS_LABEL: Record<GoalStatus, string> = {
  draft: "New",
  understanding: "Getting started",
  active: "In progress",
  waiting: "Waiting",
  blocked: "Needs a decision",
  paused: "Paused",
  verifying: "Goal check",
  unresolved: "Not resolved yet",
  achieved: "Achieved",
  escalated: "On hold: safety",
  abandoned: "Ended",
};

/** What each status means, for tooltips and screen readers. */
export const STATUS_HELP: Record<GoalStatus, string> = {
  draft: "Nothing has been described yet.",
  understanding: "Stepwise is asking questions to understand the goal.",
  active: "There is a next action you can take.",
  waiting: "The only open step is waiting for its timer.",
  blocked:
    "Repeated changes didn't work. Choose another approach, get professional help, pause or end.",
  paused: "You paused this goal. Nothing is lost.",
  verifying: "Every step is done. The goal check decides whether the goal is achieved.",
  unresolved: "The goal check didn't pass. The steps are done, but the goal isn't verified.",
  achieved: "The goal check passed.",
  escalated: "Stopped for safety or professional help. Confirm it's safe before continuing.",
  abandoned: "You ended this goal without a verified result.",
};

export const STICKY: ReadonlySet<GoalStatus> = new Set(["escalated", "abandoned"]);
export const TERMINAL: ReadonlySet<GoalStatus> = new Set(["achieved", "abandoned"]);

export function isGoalStatus(v: unknown): v is GoalStatus {
  return typeof v === "string" && (GOAL_STATUSES as readonly string[]).includes(v);
}

const lastOf = (g: Goal, kinds: string[]) =>
  [...g.messages].reverse().find((m) => kinds.includes(m.kind))?.kind;

/** The status implied by stored state alone (ignores sticky statuses). `now` matters only for timers. */
export function deriveStatus(g: Goal, now: number): Exclude<GoalStatus, "escalated" | "abandoned"> {
  if (g.achieved) return "achieved";
  if (g.paused) return "paused";
  if (!g.planned) return g.messages.some((m) => m.role === "user") ? "understanding" : "draft";
  if (g.messages.at(-1)?.kind === "replanLimit") return "blocked";
  const plan = E.planOf(g);
  if (plan.steps.length > 0 && plan.steps.every((s) => g.completed.includes(s.id)))
    return lastOf(g, ["check", "checkFail"]) === "checkFail" ? "unresolved" : "verifying";
  if (g.started) {
    const open = E.availableSteps(g.completed, plan);
    const running = (id: string) => (E.timerRemaining(g, id, now) ?? 0) > 0;
    if (open.length > 0 && open.every(running)) return "waiting";
  }
  return "active";
}

/**
 * Allowed moves between statuses (self-moves are always allowed). Every move the engine can produce is
 * listed; anything else is refused server-side so a bug can't, for example, turn `abandoned` into
 * `achieved`. `achieved` only leaves for a safety hold.
 */
export const TRANSITIONS: Record<GoalStatus, readonly GoalStatus[]> = {
  draft: ["understanding", "active", "escalated", "abandoned"],
  understanding: ["active", "escalated", "abandoned"],
  active: ["waiting", "blocked", "paused", "verifying", "escalated", "abandoned"],
  waiting: ["active", "paused", "verifying", "escalated", "abandoned"],
  blocked: ["active", "unresolved", "verifying", "paused", "escalated", "abandoned"],
  paused: ["active", "waiting", "blocked", "verifying", "unresolved", "escalated", "abandoned"],
  verifying: ["achieved", "unresolved", "active", "blocked", "paused", "escalated", "abandoned"],
  unresolved: ["active", "verifying", "blocked", "paused", "escalated", "abandoned"],
  achieved: ["escalated"],
  escalated: [
    "draft",
    "understanding",
    "active",
    "waiting",
    "blocked",
    "paused",
    "verifying",
    "unresolved",
    "achieved",
    "abandoned",
  ],
  abandoned: [],
};

export function canTransition(from: GoalStatus, to: GoalStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** An explicit lifecycle event. Everything else is a normal action whose result is derived. */
export type LifecycleEvent =
  | { type: "end"; reason: string }
  | { type: "escalate"; reason: string }
  | { type: "resolveEscalation" };

export type StatusChange =
  | { ok: true; status: GoalStatus; reason: string | null; changed: boolean }
  | { ok: false; error: string };

/** The current status: a sticky stored status wins; otherwise it's derived from state. */
export function currentStatus(g: Goal, now: number): GoalStatus {
  return g.status && STICKY.has(g.status) ? g.status : deriveStatus(g, now);
}

/**
 * Decides the status after an action. `before` carries the stored status; `after` is the engine result.
 * Fails closed: an impossible move returns an error and the caller saves nothing.
 */
export function nextStatus(
  before: Goal,
  after: Goal,
  now: number,
  event?: LifecycleEvent,
): StatusChange {
  const from = currentStatus(before, now);
  let to: GoalStatus;
  let reason: string | null = STICKY.has(from) ? (before.statusReason ?? null) : null;
  if (event?.type === "end") {
    if (TERMINAL.has(from)) return { ok: false, error: "This goal has already finished." };
    to = "abandoned";
    reason = event.reason.trim();
  } else if (event?.type === "escalate") {
    if (from === "abandoned") return { ok: false, error: "This goal has ended." };
    to = "escalated";
    reason = event.reason.trim();
  } else if (event?.type === "resolveEscalation") {
    if (from !== "escalated") return { ok: false, error: "This goal isn't on hold." };
    to = deriveStatus(after, now);
    reason = null;
  } else if (STICKY.has(from)) {
    to = from;
  } else {
    to = deriveStatus(after, now);
  }
  if (!canTransition(from, to))
    return { ok: false, error: `Can't move a goal from ${from} to ${to}.` };
  return { ok: true, status: to, reason, changed: from !== to };
}

/** Which actions a sticky status still allows. */
export function actionAllowed(status: GoalStatus, action: string): boolean {
  if (status === "abandoned") return false;
  if (status === "escalated")
    return ["text", "resolveEscalation", "end", "retryAi"].includes(action);
  return true;
}

export const ESCALATED_HOLD_LINE =
  "This goal is on hold for safety. When it's safe to continue, tap \u201cIt's safe to continue\u201d.";
export const ENDED_LINE = "Goal ended without a verified result.";
export const ESCALATE_LINE =
  "Marked for professional help. I won't guide hands-on steps until you confirm it's safe to continue.";
export const RESOLVED_LINE = "Continuing. Stop and tell me if anything seems unsafe.";
