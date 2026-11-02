// ADR-0001 lifecycle: deterministic statuses, the transition table and sticky events.
import { describe, expect, it } from "vitest";
import * as E from "./engine";
import type { Goal } from "./engine";
import {
  GOAL_STATUSES,
  TRANSITIONS,
  actionAllowed,
  canTransition,
  currentStatus,
  deriveStatus,
  nextStatus,
  type GoalStatus,
} from "./lifecycle";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const phone = () => E.startGoal(E.planGoal(E.newGoal("g"), "phone", E.getPlan("phone")));

function fill(g: Goal, stepId: string): Goal {
  const step = E.getStep(stepId, E.planOf(g));
  let out = E.setAck(g, stepId, true);
  for (const it of step.proof)
    out = E.setProof(
      out,
      stepId,
      it.id,
      it.kind === "check"
        ? true
        : it.kind === "passfail"
          ? "pass"
          : it.kind === "number"
            ? String(it.min ?? 40)
            : "x",
    );
  return out;
}

/** Completes every step (s5's 30-minute timer is treated as already finished). */
function allStepsDone(): Goal {
  let g = phone();
  for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
    g = fill(g, id);
    if (id === "s5") g = { ...g, timers: { s5: new Date(0).toISOString() } };
    g = E.submitProof(g, id);
  }
  return g;
}

describe("deriveStatus", () => {
  it("draft → understanding → active", () => {
    const g = E.newGoal("g");
    expect(deriveStatus(g, NOW)).toBe("draft");
    expect(deriveStatus(E.userText(g, "fix my laptop"), NOW)).toBe("understanding");
    expect(deriveStatus(E.planGoal(g, "phone", E.getPlan("phone")), NOW)).toBe("active");
    expect(deriveStatus(phone(), NOW)).toBe("active");
  });

  it("waiting only while the open step's timer runs", () => {
    let g = phone();
    for (const id of ["s1", "s2", "s3", "s4"]) g = E.submitProof(fill(g, id), id);
    expect(E.availableSteps(g.completed, E.planOf(g))).toEqual(["s5"]);
    expect(deriveStatus(g, NOW)).toBe("active"); // timer not started: the user has to act
    g = { ...g, timers: { s5: new Date(NOW).toISOString() } };
    expect(deriveStatus(g, NOW + 60_000)).toBe("waiting");
    expect(deriveStatus(g, NOW + 31 * 60_000)).toBe("active");
  });

  it("checklist complete is 'verifying', never achieved", () => {
    const g = allStepsDone();
    expect(g.achieved).toBe(false);
    expect(deriveStatus(g, NOW)).toBe("verifying");
  });

  it("a failed Goal check is 'unresolved'; retrying the check is 'verifying' again", () => {
    let g = allStepsDone();
    const base = Number(g.proofs["s5"]?.["before"]);
    g = E.submitCheck(E.setCheckValue(g, String(base + 1)));
    g = E.askReplan(g, "check");
    expect(g.achieved).toBe(false);
    expect(deriveStatus(g, NOW)).toBe("unresolved");
    expect(deriveStatus(E.retryCheck(g), NOW)).toBe("verifying");
  });

  it("only a passed Goal check is achieved", () => {
    const g = allStepsDone();
    const base = Number(g.proofs["s5"]?.["before"]);
    expect(deriveStatus(E.submitCheck(E.setCheckValue(g, String(base + 5))), NOW)).toBe("achieved");
  });

  it("blocked after the replan limit; paused wins over everything but achieved", () => {
    const g = { ...phone(), replanCount: 3 };
    const blocked = E.askReplan(g, "stuck", "s1");
    expect(blocked.messages.at(-1)?.kind).toBe("replanLimit");
    expect(deriveStatus(blocked, NOW)).toBe("blocked");
    expect(deriveStatus(E.goalPaused(blocked), NOW)).toBe("paused");
    expect(deriveStatus(E.askReplan(blocked, "text", undefined, true), NOW)).toBe("active");
  });
});

describe("transition table", () => {
  it("abandoned is final and achieved can only be put on safety hold", () => {
    for (const to of GOAL_STATUSES) {
      expect(canTransition("abandoned", to)).toBe(to === "abandoned");
      expect(canTransition("achieved", to)).toBe(to === "achieved" || to === "escalated");
    }
  });

  it("achieved is reachable only from verifying (a passed check) or after a safety hold", () => {
    const into = GOAL_STATUSES.filter(
      (s) => s !== "achieved" && TRANSITIONS[s].includes("achieved"),
    );
    expect(into.sort()).toEqual(["escalated", "verifying"]);
  });

  it("every status lists only known statuses", () => {
    for (const s of GOAL_STATUSES)
      for (const t of TRANSITIONS[s]) expect(GOAL_STATUSES).toContain(t as GoalStatus);
  });

  it("every move in a realistic journey with a failed check and a replan is allowed", () => {
    const states: Goal[] = [];
    let g = E.newGoal("g");
    states.push(g, E.userText(g, "my phone won't charge"));
    g = E.planGoal(g, "phone", E.getPlan("phone"));
    states.push(g);
    g = E.startGoal(g);
    states.push(g, E.goalPaused(g), g);
    for (const id of ["s1", "s2", "s3", "s4"]) {
      g = E.submitProof(fill(g, id), id);
      states.push(g);
    }
    g = { ...g, timers: { s5: new Date(NOW).toISOString() } };
    states.push(g);
    g = E.submitProof(fill({ ...g, timers: { s5: new Date(0).toISOString() } }, "s5"), "s5");
    states.push(g);
    const base = Number(g.proofs["s5"]?.["before"]);
    g = E.askReplan(E.submitCheck(E.setCheckValue(g, String(base))), "check");
    states.push(g, E.retryCheck(g));
    g = E.submitCheck(E.setCheckValue(E.retryCheck(g), String(base + 5)));
    states.push(g);

    const seen = states.map((s) => deriveStatus(s, NOW));
    expect(seen).toEqual(
      expect.arrayContaining([
        "draft",
        "understanding",
        "active",
        "paused",
        "waiting",
        "verifying",
      ]),
    );
    expect(seen).toContain("unresolved");
    expect(seen.at(-1)).toBe("achieved");
    for (let i = 1; i < seen.length; i++)
      expect(canTransition(seen[i - 1]!, seen[i]!), `${seen[i - 1]} → ${seen[i]}`).toBe(true);
  });
});

describe("nextStatus and sticky events", () => {
  const active = { ...phone(), status: "active" as const };

  it("end → abandoned with the user's reason; stays abandoned through later saves", () => {
    const r = nextStatus(active, active, NOW, { type: "end", reason: "  Bought a new phone " });
    expect(r).toEqual({
      ok: true,
      status: "abandoned",
      reason: "Bought a new phone",
      changed: true,
    });
    const ended = { ...active, status: "abandoned" as const, statusReason: "Bought a new phone" };
    const later = nextStatus(ended, E.goalPaused(ended), NOW);
    expect(later).toMatchObject({ ok: true, status: "abandoned", reason: "Bought a new phone" });
  });

  it("can't end a goal that is already achieved or ended", () => {
    const done = { ...active, achieved: true, status: "achieved" as const };
    expect(nextStatus(done, done, NOW, { type: "end", reason: "x" }).ok).toBe(false);
    const ended = { ...active, status: "abandoned" as const };
    expect(nextStatus(ended, ended, NOW, { type: "end", reason: "x" }).ok).toBe(false);
    expect(nextStatus(ended, ended, NOW, { type: "escalate", reason: "x" }).ok).toBe(false);
  });

  it("escalated holds until the user resolves it, then re-derives", () => {
    const esc = nextStatus(active, active, NOW, {
      type: "escalate",
      reason: "Fire, smoke or sparks",
    });
    expect(esc).toMatchObject({ ok: true, status: "escalated", reason: "Fire, smoke or sparks" });
    const held = { ...active, status: "escalated" as const, statusReason: "Fire, smoke or sparks" };
    expect(currentStatus(held, NOW)).toBe("escalated");
    expect(nextStatus(held, held, NOW)).toMatchObject({ status: "escalated" });
    expect(nextStatus(held, held, NOW, { type: "resolveEscalation" })).toEqual({
      ok: true,
      status: "active",
      reason: null,
      changed: true,
    });
    expect(nextStatus(active, active, NOW, { type: "resolveEscalation" }).ok).toBe(false);
  });

  it("an impossible derived move is refused (fails closed)", () => {
    const stored = { ...active, achieved: true, status: "achieved" as const };
    // A buggy action that un-achieves the goal must not be saved.
    const r = nextStatus(stored, { ...stored, achieved: false }, NOW);
    expect(r.ok).toBe(false);
  });

  it("actions allowed per status", () => {
    expect(actionAllowed("abandoned", "text")).toBe(false);
    expect(actionAllowed("escalated", "start")).toBe(false);
    expect(actionAllowed("escalated", "resolveEscalation")).toBe(true);
    expect(actionAllowed("escalated", "end")).toBe(true);
    expect(actionAllowed("active", "start")).toBe(true);
  });
});
