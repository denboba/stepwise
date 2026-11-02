// Agent activity events: what the assistant is doing, shown as a live card in the chat.
// Display-only. Events never change goal state; they are recorded around existing AI calls.
import type { Goal, Msg } from "./engine";

export type ActivityStatus = "waiting" | "running" | "done" | "failed";
export type ActivityPhase = "understand" | "research" | "plan" | "do" | "check";

export interface ActivityEvent {
  id: string;
  phase: ActivityPhase;
  label: string;
  status: ActivityStatus;
  detail?: string;
  startedAt: number;
  endedAt?: number;
}

/** Every label the agent may show. Each is at most 6 words (tested). */
export const LABELS = {
  understand: "Understanding your goal",
  plan: "Building your plan",
  validate: "Checking the plan",
  photo: "Checking your photo",
  replan: "Updating your plan",
  validatePatch: "Checking the update",
  // Planned: web research.
  search: "Searching the web",
  read: "Reading sources",
} as const;

export const MAX_ACTIVITY_WORDS = 6;

/** Collects events on the server while an action runs. */
export function recorder() {
  const events: ActivityEvent[] = [];
  let n = 0;
  return {
    events,
    async step<T>(phase: ActivityPhase, label: string, fn: () => Promise<T>): Promise<T> {
      const ev: ActivityEvent = {
        id: `a${++n}`,
        phase,
        label,
        status: "running",
        startedAt: Date.now(),
      };
      events.push(ev);
      try {
        const out = await fn();
        ev.status = "done";
        return out;
      } catch (e) {
        ev.status = "failed";
        throw e;
      } finally {
        ev.endedAt = Date.now();
      }
    },
  };
}
export type Recorder = ReturnType<typeof recorder>;

/**
 * Places one activity message before the assistant's new replies (after any echoed user text)
 * and renumbers the new messages so order is preserved.
 */
export function withActivity(before: Goal, after: Goal, events: ActivityEvent[]): Goal {
  if (!events.length || after === before) return after;
  const added = after.messages.slice(before.messages.length);
  if (!added.length) return after;
  const at = Math.max(
    0,
    added.findIndex((m) => m.role === "assistant"),
  );
  const activity = { role: "assistant", kind: "activity", events } as Omit<
    Extract<Msg, { kind: "activity" }>,
    "id"
  >;
  const list = [...added.slice(0, at), activity, ...added.slice(at)];
  let seq = before.seq;
  const renumbered = list.map((m) => ({ ...m, id: `${after.id}-${++seq}` }) as Msg);
  return { ...after, seq, messages: [...before.messages, ...renumbered] };
}

/** Parses saved events, dropping anything malformed. */
export function parseEvents(raw: string | null): ActivityEvent[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((e) => e && typeof e.label === "string" && typeof e.startedAt === "number")
      .slice(0, 12) as ActivityEvent[];
  } catch {
    return [];
  }
}

export function workedFor(events: ActivityEvent[]): number {
  if (!events.length) return 0;
  const start = Math.min(...events.map((e) => e.startedAt));
  const end = Math.max(...events.map((e) => e.endedAt ?? e.startedAt));
  return Math.max(1, Math.round((end - start) / 1000));
}
