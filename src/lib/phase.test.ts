import { describe, it, expect } from "vitest";
import * as E from "./engine";
import { PLANS } from "./plan";
import { derivePhase, groupSteps, phases } from "./phase";
import { LABELS, MAX_ACTIVITY_WORDS, withActivity, workedFor } from "./activity";

const phone = PLANS.find((p) => p.id.includes("phone")) ?? PLANS[0]!;
function planned() {
  return E.startGoal(E.sendText(E.newGoal("g"), "my phone won't charge"));
}

describe("phase tracker", () => {
  it("is Understand before a plan exists", () => {
    expect(derivePhase(E.newGoal("g"))).toBe("understand");
  });
  it("is Plan while a plan is being built", () => {
    expect(derivePhase(E.newGoal("g"), { planning: true })).toBe("plan");
  });
  it("stays Do until every step is done", () => {
    const g = planned();
    expect(derivePhase(g)).toBe("do");
    const almost = { ...g, completed: phone.steps.slice(0, -1).map((s) => s.id) };
    expect(derivePhase(almost)).toBe("do");
    expect(derivePhase({ ...g, completed: phone.steps.map((s) => s.id) })).toBe("check");
  });
  it("hides Research unless the goal used it", () => {
    expect(phases(planned())).not.toContain("research");
  });
});

describe("plan groups", () => {
  it("puts available steps in Now and nothing in Done at the start", () => {
    const g = planned();
    const gr = groupSteps(g);
    expect(gr.now).toEqual(E.availableSteps([], phone));
    expect(gr.done).toEqual([]);
    expect(gr.now.length + gr.next.length + gr.later.length).toBe(phone.steps.length);
  });
  it("Next holds only steps whose missing prerequisites are all available", () => {
    const g = planned();
    for (const id of groupSteps(g).next) {
      const s = E.getStep(id, phone);
      for (const r of s.prereqs) expect(E.stepStatus(r, [], phone)).toBe("available");
    }
  });
});

describe("activity", () => {
  it("every label is at most 6 words", () => {
    for (const l of Object.values(LABELS))
      expect(l.split(/\s+/).length).toBeLessThanOrEqual(MAX_ACTIVITY_WORDS);
  });
  it("places the activity record before the assistant reply, after the user's text", () => {
    const before = E.newGoal("g");
    const after = E.sendText(before, "my phone won't charge");
    const ev = [
      {
        id: "a1",
        phase: "plan" as const,
        label: LABELS.plan,
        status: "done" as const,
        startedAt: 0,
        endedAt: 3000,
      },
    ];
    const out = withActivity(before, after, ev);
    expect(out.messages[0]?.role).toBe("user");
    expect(out.messages[1]?.kind).toBe("activity");
    expect(out.messages.length).toBe(after.messages.length + 1);
    expect(out.seq).toBe(after.seq + 1);
  });
  it("reports worked-for seconds", () => {
    expect(
      workedFor([
        { id: "a", phase: "plan", label: "x", status: "done", startedAt: 0, endedAt: 12000 },
      ]),
    ).toBe(12);
  });
});
