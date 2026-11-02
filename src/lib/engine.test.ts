import { describe, it, expect } from "vitest";
import { PLANS } from "./plan";
import * as E2 from "./engine";
import {
  availableSteps,
  newlyUnlocked,
  goalCheckPasses,
  newGoal,
  sendText,
  startGoal,
  setProof,
  setAck,
  submitProof,
  itemSatisfied,
  passFailCheckPasses,
  getPlan,
  planGoal,
  setCheckProof,
  submitCheck,
  validateAiPlan,
  aiPlanToPlan,
  askIntake,
  sideAnswer,
  type AiPlan,
  type Goal,
} from "./engine";

const PHONE_GOAL = "my phone won't charge";

const lastText = (g: Goal) => {
  const t = g.messages.filter((m) => m.kind === "text" && m.role === "assistant");
  return (t[t.length - 1] as { text: string }).text;
};

describe("unlock rules", () => {
  it("s2 and s3 unlock together after s1", () => {
    expect(newlyUnlocked([], ["s1"])).toEqual(["s2", "s3"]);
  });
  it("s5 needs both s3 and s4", () => {
    expect(availableSteps(["s1", "s2", "s4"])).not.toContain("s5");
    expect(availableSteps(["s1", "s3", "s2"])).not.toContain("s5");
    expect(availableSteps(["s1", "s2", "s3", "s4"])).toEqual(["s5"]);
  });
});

describe("input routing", () => {
  it("text matching no template only records the user message (custom intake takes over)", () => {
    const g = sendText(newGoal("g"), "bake a cake");
    expect(g.planned).toBe(false);
    expect(g.messages).toHaveLength(1);
    expect(g.messages[0]).toMatchObject({ role: "user", kind: "text", text: "bake a cake" });
  });
  it("a phone that won't charge plans the phone goal", () => {
    expect(sendText(newGoal("g"), "my phone won't charge").planId).toBe("phone");
  });
  it("'charge' without a phone no longer hijacks the goal", () => {
    expect(sendText(newGoal("g"), "it won't charge").planned).toBe(false);
  });
  it("'done' with open task lists missing proof", () => {
    let g = startGoal(sendText(newGoal("g"), PHONE_GOAL));
    g = setAck(g, "s1", true);
    g = setProof(g, "s1", "off", true);
    g = sendText(g, "done");
    expect(lastText(g)).toBe("Not yet. Missing proof: Workspace is dry and lit, Tools in hand");
  });
  it("other text returns to the open step", () => {
    const g = sendText(startGoal(sendText(newGoal("g"), PHONE_GOAL)), "hello");
    expect(lastText(g)).toBe("I can only help with the open step. Back to Step 1:");
  });
  it("submit is refused until proof is complete", () => {
    let g = startGoal(sendText(newGoal("g"), PHONE_GOAL));
    g = setProof(
      setProof(setProof(g, "s1", "off", true), "s1", "space", true),
      "s1",
      "tools",
      true,
    );
    expect(submitProof(g, "s1").completed).toEqual([]);
    expect(submitProof(setAck(g, "s1", true), "s1").completed).toEqual(["s1"]);
  });
});

describe("goal check", () => {
  it("passes at before + 5", () => expect(goalCheckPasses("40", "45")).toBe(true));
  it("fails at before + 4", () => expect(goalCheckPasses("40", "44")).toBe(false));
});

describe("website and robot plans", () => {
  const web = getPlan("website");
  const bot = getPlan("robot");
  it("typing 'website' or 'line-following robot' picks that plan", () => {
    expect(sendText(newGoal("g"), "I need a website").planId).toBe("website");
    expect(sendText(newGoal("g"), "build a line-following robot").planId).toBe("robot");
  });
  it("w2 and w3 unlock together after w1", () => {
    expect(newlyUnlocked([], ["w1"], web)).toEqual(["w2", "w3"]);
  });
  it("w5 needs both w2 and w3", () => {
    expect(availableSteps(["w1", "w2"], web)).not.toContain("w5");
    expect(availableSteps(["w1", "w2", "w3"], web)).toContain("w5");
  });
  it("w8 needs both w4 and w7", () => {
    expect(availableSteps(["w1", "w2", "w3", "w5", "w6", "w7"], web)).not.toContain("w8");
    expect(availableSteps(["w1", "w2", "w3", "w4", "w5", "w6", "w7"], web)).toContain("w8");
  });
  it("r8 needs both r7 and r3", () => {
    expect(availableSteps(["r1", "r2", "r4", "r5", "r6", "r7"], bot)).not.toContain("r8");
    expect(availableSteps(["r1", "r2", "r3", "r4", "r5", "r6", "r7"], bot)).toContain("r8");
  });
});

describe("number limits", () => {
  it("photos need at least 3", () => {
    expect(itemSatisfied({ kind: "number", min: 3 }, "2")).toBe(false);
    expect(itemSatisfied({ kind: "number", min: 3 }, "3")).toBe(true);
  });
  it("track needs at least 200 cm", () => {
    expect(itemSatisfied({ kind: "number", min: 200 }, "199")).toBe(false);
    expect(itemSatisfied({ kind: "number", min: 200 }, "200")).toBe(true);
  });
  it("sensor height must be 5 to 10 mm", () => {
    const h = { kind: "number" as const, min: 5, max: 10 };
    expect(itemSatisfied(h, "4")).toBe(false);
    expect(itemSatisfied(h, "5")).toBe(true);
    expect(itemSatisfied(h, "10")).toBe(true);
    expect(itemSatisfied(h, "11")).toBe(false);
  });
});

describe("pass/fail goal checks", () => {
  const check = getPlan("robot").check;
  const items = check.kind === "passfail" ? check.items : [];
  it("robot passes only with 3 of 3 runs", () => {
    expect(passFailCheckPasses(items, { run1: "pass", run2: "pass", run3: "pass" })).toBe(true);
    expect(passFailCheckPasses(items, { run1: "pass", run2: "fail", run3: "pass" })).toBe(false);
  });
  it("a failed run gives Goal not met", () => {
    let g = planGoal(newGoal("g"), "robot");
    g = { ...g, started: true, completed: ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"] };
    g = setCheckProof(
      setCheckProof(setCheckProof(g, "run1", "pass"), "run2", "pass"),
      "run3",
      "fail",
    );
    const out = submitCheck(g);
    expect(out.achieved).toBe(false);
    expect(out.messages.at(-1)?.kind).toBe("checkFail");
    const ok = submitCheck(setCheckProof(g, "run3", "pass"));
    expect(ok.achieved).toBe(true);
  });
});

const validAiPlan = (): AiPlan => ({
  goal: "Bake a loaf of bread",
  done_means: "A baked loaf that sounds hollow when tapped on the bottom.",
  steps: [
    {
      id: "a",
      title: "Gather ingredients",
      est_minutes: 10,
      safety_note: null,
      actions: ["Get flour, yeast, salt, water."],
      why: "Everything in reach.",
      hint: "Any plain flour works.",
      prerequisites: [],
      proof: [
        { label: "Ingredients on the counter", type: "checkbox", min: null, max: null },
        { label: "Flour amount in grams", type: "number", min: 300, max: null },
      ],
      wait_seconds: null,
    },
    {
      id: "b",
      title: "Mix and knead",
      est_minutes: 15,
      safety_note: null,
      actions: ["Mix.", "Knead 10 minutes."],
      why: "Gluten gives structure.",
      hint: "Push, fold, turn.",
      prerequisites: ["a"],
      proof: [
        { label: "Dough is smooth", type: "passfail", min: null, max: null },
        { label: "Knead time in minutes", type: "number", min: 8, max: null },
      ],
      wait_seconds: null,
    },
    {
      id: "c",
      title: "First rise",
      est_minutes: 60,
      safety_note: null,
      actions: ["Cover and wait."],
      why: "Yeast needs time.",
      hint: "A warm spot helps.",
      prerequisites: ["b"],
      proof: [
        { label: "Dough doubled", type: "passfail", min: null, max: null },
        { label: "Photo of the risen dough", type: "photo", min: null, max: null },
      ],
      wait_seconds: 3600,
    },
    {
      id: "d",
      title: "Bake",
      est_minutes: 30,
      safety_note: "Oven is hot; use mitts.",
      actions: ["Bake at 220C."],
      why: "Heat sets the crumb.",
      hint: "Tap the bottom.",
      prerequisites: ["c"],
      proof: [
        { label: "Sounds hollow", type: "passfail", min: null, max: null },
        { label: "Bake time in minutes", type: "number", min: 20, max: null },
      ],
      wait_seconds: null,
    },
  ],
  goal_check: [{ label: "Loaf sounds hollow when tapped", type: "passfail", min: null, max: null }],
});

describe("AI plan validation", () => {
  it("accepts a valid plan", () => {
    expect(validateAiPlan(validAiPlan())).toEqual([]);
  });
  it("rejects duplicate step ids", () => {
    const p = validAiPlan();
    p.steps[1]!.id = "a";
    expect(validateAiPlan(p).join(" ")).toContain('Duplicate step id "a"');
  });
  it("rejects unknown prerequisites", () => {
    const p = validAiPlan();
    p.steps[1]!.prerequisites = ["zzz"];
    expect(validateAiPlan(p).join(" ")).toContain('unknown prerequisite "zzz"');
  });
  it("rejects circular dependencies", () => {
    const p = validAiPlan();
    p.steps[0]!.prerequisites = ["d"];
    expect(validateAiPlan(p).join(" ")).toContain("Circular dependency");
  });
  it("rejects a step with fewer than 2 proof items", () => {
    const p = validAiPlan();
    p.steps[0]!.proof = [{ label: "Done", type: "checkbox", min: null, max: null }];
    expect(validateAiPlan(p).join(" ")).toContain("2 to 4 proof items");
  });
  it("rejects a step with no objective proof item", () => {
    const p = validAiPlan();
    p.steps[0]!.proof = [
      { label: "One", type: "checkbox", min: null, max: null },
      { label: "Two", type: "text", min: null, max: null },
    ];
    expect(validateAiPlan(p).join(" ")).toContain("objective proof item");
  });
  it("rejects a missing goal check", () => {
    const p = validAiPlan();
    p.goal_check = [];
    expect(validateAiPlan(p).join(" ")).toContain("goal_check must have 1 to 3 items");
  });
  it("rejects too few steps", () => {
    const p = validAiPlan();
    p.steps = p.steps.slice(0, 3);
    expect(validateAiPlan(p).join(" ")).toContain("4 to 10");
  });
});

describe("AI plan mapping", () => {
  it("maps types, bounds, safety and wait seconds onto a Plan", () => {
    const plan = aiPlanToPlan(validAiPlan(), "custom:g1");
    expect(plan.id).toBe("custom:g1");
    expect(plan.steps[0]!.proof[0]!).toMatchObject({ id: "p1", kind: "check" });
    expect(plan.steps[0]!.proof[1]!).toMatchObject({ kind: "number", min: 300 });
    expect(plan.steps[2]!.proof[1]!.kind).toBe("photo");
    expect(plan.steps[2]!.waitSeconds).toBe(3600);
    expect(plan.steps[3]!.safety).toContain("Oven is hot");
    expect(plan.check).toEqual({
      kind: "passfail",
      items: [{ id: "c1", label: "Loaf sounds hollow when tapped", kind: "passfail" }],
    });
  });
});

describe("custom goal flow", () => {
  it("askIntake posts a question with options", () => {
    const g = askIntake(sendText(newGoal("g"), "bake bread"), "What is your skill level?", [
      "Beginner",
      "Some experience",
    ]);
    const m = g.messages.at(-1);
    expect(m).toMatchObject({
      role: "assistant",
      kind: "intake",
      question: "What is your skill level?",
      options: ["Beginner", "Some experience"],
    });
  });
  it("a side answer is followed by the open task again", () => {
    let g = startGoal(sendText(newGoal("g"), PHONE_GOAL));
    g = sideAnswer(g, "Any USB cable works for the test.");
    const texts = g.messages.filter((m) => m.kind === "text" && m.role === "assistant");
    expect((texts.at(-1) as { text: string }).text).toBe("Any USB cable works for the test.");
    expect(g.messages.at(-1)).toMatchObject({ kind: "tasks", stepIds: ["s1"] });
  });
});

describe("photo proof and timers", () => {
  const base = () => {
    const g = E2.startGoal(E2.planGoal(E2.newGoal("g")));
    return { ...g, completed: ["s1", "s2", "s3", "s4"] };
  };
  it("phone s5 has a 30-minute timer and a battery-screen photo", () => {
    const s5 = E2.getStep("s5");
    expect(s5.waitSeconds).toBe(1800);
    expect(E2.hasPhotoProof(s5)).toBe(true);
  });
  it("timer blocks submit until started and 30 minutes pass", () => {
    const g = base();
    expect(E2.timerBlocks(g, "s5", Date.now())).toBe(true);
    const start = Date.parse("2026-01-01T00:00:00Z");
    const t = { ...g, timers: { s5: new Date(start).toISOString() } };
    expect(E2.timerRemaining(t, "s5", start + 60_000)).toBe(1740);
    expect(E2.timerBlocks(t, "s5", start + 1799_000)).toBe(true);
    expect(E2.timerBlocks(t, "s5", start + 1800_000)).toBe(false);
  });
  it("timer done posts one line", () => {
    const g = E2.timerDone(base());
    const last = g.messages[g.messages.length - 1] as { text?: string };
    expect(last.text).toBe("Timer done. Submit your proof.");
  });
  it("missing photo verdict names the items and re-shows the task", () => {
    const g = E2.photoMissing(base(), ["charging icon"]);
    const texts = g.messages
      .filter((m) => m.kind === "text")
      .map((m) => (m as { text: string }).text);
    expect(texts).toContain("Not verified. Missing: charging icon");
    expect(g.messages[g.messages.length - 1]?.kind).toBe("tasks");
    expect(g.completed).not.toContain("s5");
  });
});

describe("adaptive replanning", () => {
  const base = E2.planGoal(E2.newGoal("r"), "phone", E2.getPlan("phone"));
  const plan = E2.planOf(base);
  const first = plan.steps.find((s) => s.prereqs.length === 0)!;
  const locked = plan.steps.find((s) => s.prereqs.includes(first.id))!;
  const step = (id: string, prereqs: string[]) => ({
    id,
    title: `New ${id}`,
    est_minutes: 5,
    safety_note: null,
    actions: ["Do it"],
    why: "w",
    hint: "h",
    prerequisites: prereqs,
    proof: [
      { label: "Value", type: "number", min: null, max: null },
      { label: "Ok", type: "checkbox", min: null, max: null },
    ],
    wait_seconds: null,
  });
  const patch = (p: Partial<E2.PlanPatch>): E2.PlanPatch => ({
    add_steps: [],
    modify_steps: [],
    remove_steps: [],
    reason: "Part differs.",
    ...p,
  });

  it("accepts a valid patch that adds a step", () => {
    expect(E2.validatePatch(plan, [], patch({ add_steps: [step("x1", [first.id])] }))).toEqual([]);
  });
  it("never changes a done step", () => {
    const errs = E2.validatePatch(plan, [first.id], patch({ modify_steps: [step(first.id, [])] }));
    expect(errs.some((e) => e.includes("done"))).toBe(true);
  });
  it("never removes a done step", () => {
    const errs = E2.validatePatch(plan, [first.id], patch({ remove_steps: [first.id] }));
    expect(errs.some((e) => e.includes("done"))).toBe(true);
  });
  it("rejects unknown prerequisites", () => {
    expect(
      E2.validatePatch(plan, [], patch({ add_steps: [step("x1", ["nope"])] })).length,
    ).toBeGreaterThan(0);
  });
  it("rejects cycles", () => {
    const a = step("a1", ["b1"]);
    const b = step("b1", ["a1"]);
    const errs = E2.validatePatch(plan, [], patch({ add_steps: [a, b] }));
    expect(errs.some((e) => e.includes("circular"))).toBe(true);
  });
  it("requires an objective proof item on new steps", () => {
    const s = step("x1", []);
    s.proof = [
      { label: "a", type: "checkbox", min: null, max: null },
      { label: "b", type: "text", min: null, max: null },
    ];
    expect(E2.validatePatch(plan, [], patch({ add_steps: [s] })).length).toBeGreaterThan(0);
  });
  it("never unlocks a locked step", () => {
    const errs = E2.validatePatch(plan, [], patch({ modify_steps: [step(locked.id, [])] }));
    expect(errs.some((e) => e.includes("unlock"))).toBe(true);
  });
  it("applying keeps completed steps and adds the new one", () => {
    const next = E2.applyPatch(plan, patch({ add_steps: [step("x1", [first.id])] }));
    expect(next.steps.find((s) => s.id === first.id)).toEqual(first);
    expect(next.steps.some((s) => s.id === "x1")).toBe(true);
  });
  it("second I'm stuck tap on the same step triggers replanning", () => {
    expect(E2.stuckTriggersReplan(base, first.id)).toBe(false);
    expect(E2.stuckTriggersReplan({ ...base, stuckCounts: { [first.id]: 1 } }, first.id)).toBe(
      true,
    );
  });
  it("after 3 replans offers pause or another approach", () => {
    const g = E2.askReplan({ ...base, replanCount: 3 }, "text");
    expect(g.messages[g.messages.length - 1]?.kind).toBe("replanLimit");
    const g2 = E2.askReplan({ ...base, replanCount: 2 }, "text");
    expect(g2.messages[g2.messages.length - 1]?.kind).toBe("replanAsk");
  });
  it("replan question is at most 20 words with 3 to 4 chips", () => {
    for (const t of ["stuck", "check", "text"] as const) {
      const g = E2.askReplan(base, t, first.id);
      const m = g.messages[g.messages.length - 1] as { question: string; options: string[] };
      expect(m.question.split(/\s+/).length).toBeLessThanOrEqual(20);
      expect(m.options.length).toBeGreaterThanOrEqual(3);
      expect(m.options.length).toBeLessThanOrEqual(4);
    }
  });
  it("detects 'this didn't work' text", () => {
    expect(E2.isReplanText("this didn't work")).toBe(true);
    expect(E2.isReplanText("it's different")).toBe(true);
    expect(E2.isReplanText("how long does it take?")).toBe(false);
  });
  it("restore is refused if it would drop a done step", () => {
    const next = E2.applyPatch(plan, patch({ add_steps: [step("x1", [first.id])] }));
    const res = E2.restorePlan(next, plan, [first.id, "x1"]);
    expect(typeof res).toBe("string");
  });
});

describe("replans never weaken proof", () => {
  const base = E2.planGoal(E2.newGoal("w"), "phone", E2.getPlan("phone"));
  const plan = E2.planOf(base);
  const photoStep = plan.steps.find((s) => s.proof.some((p) => p.kind === "photo"))!;
  const toAi = (s: typeof photoStep) => E2.stepToAi(s);
  const patch = (m: ReturnType<typeof toAi>) => ({
    add_steps: [],
    modify_steps: [m],
    remove_steps: [],
    reason: "Adjust.",
  });

  it("rejects a patch removing a photo proof", () => {
    const m = toAi(photoStep);
    m.proof = m.proof.filter((p) => p.type !== "photo");
    while (m.proof.length < 2)
      m.proof.push({ label: "Extra", type: "number", min: null, max: null });
    expect(E2.validatePatch(plan, [], patch(m)).some((e) => e.includes("photo"))).toBe(true);
  });
  it("rejects a patch lowering a number minimum", () => {
    const s = {
      ...photoStep,
      proof: photoStep.proof.map((p) => (p.kind === "number" ? { ...p, min: 10 } : p)),
    };
    const p2 = { ...plan, steps: plan.steps.map((x) => (x.id === s.id ? s : x)) };
    const m = toAi(s);
    m.proof = m.proof.map((p) => (p.type === "number" ? { ...p, min: 1 } : p));
    expect(E2.validatePatch(p2, [], patch(m)).some((e) => e.includes("number proof"))).toBe(true);
  });
  it("rejects a shorter wait timer", () => {
    const m = toAi(photoStep);
    m.wait_seconds = 60;
    expect(E2.validatePatch(plan, [], patch(m)).some((e) => e.includes("timer"))).toBe(true);
  });
  it("accepts a patch that only adds proof items", () => {
    const m = toAi(photoStep);
    m.proof = [
      ...m.proof.slice(0, 3),
      { label: "Cable model", type: "text", min: null, max: null },
    ];
    expect(m.proof.length).toBeLessThanOrEqual(4);
    expect(E2.weakensProof(photoStep, E2.aiStepToStep(m))).toEqual([]);
  });
  it("offers the override when the user can't take a photo", () => {
    expect(E2.isNoPhotoText("I can't take a photo")).toBe(true);
    expect(E2.isNoPhotoText("I don't have a camera")).toBe(true);
    const g = E2.offerOverride(base, photoStep.id);
    expect(E2.canOverride(g, photoStep.id)).toBe(true);
    expect(E2.canOverride(base, photoStep.id)).toBe(false);
  });
});

describe("fixed replies stay within 25 words", () => {
  const long =
    "Photo of the battery settings screen showing the exact percentage, the charging icon, the cable brand and the wall adapter model clearly";
  const words = (s: string) => s.trim().split(/\s+/).length;
  const g0 = E2.startGoal(E2.planGoal(E2.newGoal("f"), "phone", E2.getPlan("phone")));
  const lastLine = (g: Goal) => lastText(g);
  it("Photo unclear with a long item", () => {
    const t = lastLine(E2.photoUnclear(g0, long + " " + long));
    expect(t.startsWith("Photo unclear. Retake it showing:")).toBe(true);
    expect(words(t)).toBeLessThanOrEqual(25);
  });
  it("Missing lists show at most 3 items then +N more", () => {
    const t = E2.fitList("Not yet. Missing proof:", [
      "Phone is off",
      "Workspace is dry",
      "Which light",
      "Pick is wood",
      "Extra",
    ]);
    expect(t).toBe("Not yet. Missing proof: Phone is off, Workspace is dry, Which light +2 more");
    const t2 = lastLine(E2.photoMissing(g0, [long, long, long, long]));
    expect(words(t2)).toBeLessThanOrEqual(25);
  });
  it("every built-in template's longest missing-proof line fits", () => {
    for (const p of PLANS) {
      for (const s of p.steps) {
        const t = E2.fitList("Not yet. Missing proof:", [
          "I understand",
          ...s.proof.map((x) => x.label),
        ]);
        expect(words(t)).toBeLessThanOrEqual(25);
      }
    }
  });
  it("other fixed lines fit", () => {
    for (const t of [
      E2.RATE_LINE,
      E2.DAILY_LINE,
      E2.AI_FAIL_LINE,
      E2.PAUSED_LINE,
      "I couldn't update the plan safely.",
      "This step needs a photo. You can override once with a reason.",
      "I can only help with the open step. Back to Step 10:",
      "Timer done. Submit your proof.",
    ])
      expect(words(t)).toBeLessThanOrEqual(25);
  });
});

describe("paused and repeated submissions", () => {
  it("paused line", () => {
    const g = E2.pausedLine(E2.newGoal("p"));
    expect(lastText(g)).toBe("This goal is paused. Resume it first.");
  });
  it("an identical repeat submission counts as the same proof", () => {
    expect(E2.sameProof({ p1: "40", p2: true }, { p1: "40", p2: true })).toBe(true);
    expect(E2.sameProof({ p1: "40" }, { p1: "41" })).toBe(false);
    expect(E2.sameProof({ c1: "pass" }, { c1: "pass" })).toBe(true);
  });
});

describe("override rule", () => {
  const base = E2.startGoal(E2.planGoal(E2.newGoal("o"), "phone", E2.getPlan("phone")));
  const photo = E2.planOf(base).steps.find((s) => s.proof.some((p) => p.kind === "photo"))!.id;
  it("available at once after missing", () => {
    expect(E2.canOverride({ ...base, verdicts: { [photo]: "missing" } }, photo)).toBe(true);
  });
  it("after unclear only when two in a row", () => {
    expect(
      E2.canOverride(
        { ...base, verdicts: { [photo]: "unclear" }, unclearStreak: { [photo]: 1 } },
        photo,
      ),
    ).toBe(false);
    expect(
      E2.canOverride(
        { ...base, verdicts: { [photo]: "unclear" }, unclearStreak: { [photo]: 2 } },
        photo,
      ),
    ).toBe(true);
  });
  it("once per step", () => {
    expect(
      E2.canOverride(
        { ...base, verdicts: { [photo]: "missing" }, overrides: { [photo]: "x" } },
        photo,
      ),
    ).toBe(false);
  });
});
