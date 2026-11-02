// P1 Increment 1 (spec: .kiro/specs/p1-reliable-goal-journey): template routing, intake recovery and
// honest progress. Pure engine tests; no AI or database.
import { describe, expect, it } from "vitest";
import * as E from "./engine";
import type { Goal } from "./engine";
import { wordCount } from "./text";
import { GOAL_STATUSES, STATUS_HELP, STATUS_LABEL } from "./lifecycle";

describe("R1 template routing uses whole-word phrases", () => {
  it.each([
    ["my phone won't charge", "phone"],
    ["My iPhone stopped charging", "phone"],
    ["phone's charger port seems loose", "phone"],
    ["Android phone not charging overnight", "phone"],
    ["I need a website for my bakery", "website"],
    ["Make a landing page for a workshop", "website"],
    ["build a line-following robot", "robot"],
    ["Line following car for a school contest", "robot"],
  ])("%s -> %s", (text, plan) => {
    expect(E.planForText(text)?.id).toBe(plan);
  });

  it.each([
    "I want to learn the saxophone",
    "Fix my headphones",
    "Set up a microphone for streaming",
    "I'm in charge of organizing a wedding",
    "My laptop won't charge",
    "My electric car won't charge at home",
    "My phone screen is cracked",
    "We visited a parasite lab",
    "Prepare a construction site safety checklist",
    "Build a robot arm",
    "Learn to play the xylophone",
    "Discharge my credit card debt",
  ])("%s -> custom goal", (text) => {
    expect(E.planForText(text)).toBeNull();
  });

  it("an unmatched goal stays unplanned so the AI intake takes over", () => {
    const g = E.sendText(E.newGoal("g"), "I want to learn the saxophone");
    expect(g.planned).toBe(false);
    expect(g.messages).toHaveLength(1);
  });

  it("prefix tokens only match word starts", () => {
    const words = E.textWords("recharging the battery");
    expect(E.phraseMatches("charg*", words)).toBe(false);
    expect(E.phraseMatches("recharg*", words)).toBe(true);
  });

  it("an empty phrase never matches", () => {
    expect(E.phraseMatches("   ", E.textWords("anything"))).toBe(false);
  });

  it("asterisks typed by the user are not wildcards", () => {
    expect(E.planForText("ph* charging")).toBeNull();
  });
});

const user = (g: Goal, text: string) => E.userText(g, text);

describe("R2 intake recovery uses what the user adds", () => {
  it("the first message is the goal statement", () => {
    const t = E.intakeTurn(E.newGoal("g"), "Learn to solder");
    expect(t).toEqual({ goalText: "Learn to solder", intake: [] });
  });

  it("the next text answers a pending question", () => {
    let g = user(E.newGoal("g"), "Learn to solder");
    g = E.askIntake(g, "What's your experience?", ["None", "Some"]);
    const t = E.intakeTurn(g, "None");
    expect(t.goalText).toBe("Learn to solder");
    expect(t.intake).toEqual([{ q: "What's your experience?", a: "None" }]);
  });

  it("after a failed plan, the next text is kept as extra detail (not dropped)", () => {
    let g = user(E.newGoal("g"), "Fix the thing");
    g = E.askIntake(g, "What is it?", []);
    g = { ...user(g, "A laptop"), intake: [{ q: "What is it?", a: "A laptop" }] };
    g = E.planFailed(g);
    const t = E.intakeTurn(g, "It shuts off instantly when gaming");
    expect(t.goalText).toBe("Fix the thing");
    expect(t.intake).toEqual([
      { q: "What is it?", a: "A laptop" },
      { q: E.EXTRA_DETAIL_Q, a: "It shuts off instantly when gaming" },
    ]);
  });

  it("a failed plan right after the first message still keeps the original goal", () => {
    const g = E.planFailed(user(E.newGoal("g"), "Fix the thing"));
    const t = E.intakeTurn(g, "It's a laptop that shuts down");
    expect(t.goalText).toBe("Fix the thing");
    expect(t.intake).toEqual([{ q: E.EXTRA_DETAIL_Q, a: "It's a laptop that shuts down" }]);
  });

  it("extra detail doesn't hide a later pending question", () => {
    let g = user(E.newGoal("g"), "Fix the thing");
    g = { ...user(g, "It's a laptop"), intake: [{ q: E.EXTRA_DETAIL_Q, a: "It's a laptop" }] };
    g = E.askIntake(g, "Does it show an error?", ["Yes", "No"]);
    expect(E.pendingIntakeQuestion(g)).toBe("Does it show an error?");
    expect(E.intakeTurn(g, "No").intake.at(-1)).toEqual({ q: "Does it show an error?", a: "No" });
  });

  it("an exact repeat (e.g. re-sent after a rate limit) is not stored twice", () => {
    const g = user(E.newGoal("g"), "Fix the thing");
    expect(E.intakeTurn(g, "fix the thing ").intake).toEqual([]);
    const g2 = { ...g, intake: [{ q: E.EXTRA_DETAIL_Q, a: "laptop" }] };
    expect(E.intakeTurn(g2, "Laptop").intake).toHaveLength(1);
  });

  it("the plan-failed line invites detail and fits 25 words", () => {
    expect(E.PLAN_FAILED_LINE).toMatch(/tell me more/i);
    expect(wordCount(E.PLAN_FAILED_LINE)).toBeLessThanOrEqual(25);
  });
});

describe("R3 progress never shows 100% before the Goal check passes", () => {
  const base = { planned: true, started: true, paused: false, achieved: false };

  it("all steps done but check not passed is below 100% with status 'verifying'", () => {
    expect(E.goalSummary({ ...base, done: 5, total: 5 })).toEqual({
      percent: 83,
      status: "verifying",
    });
  });

  it("achieved is 100%", () => {
    expect(E.goalSummary({ ...base, achieved: true, done: 5, total: 5 })).toEqual({
      percent: 100,
      status: "achieved",
    });
  });

  it("percent stays below 100 for any plan size when not achieved", () => {
    for (let total = 1; total <= 300; total++)
      expect(E.goalSummary({ ...base, done: total, total }).percent).toBeLessThan(100);
  });

  it.each([
    [
      { planned: false, started: false, paused: false, achieved: false, done: 0, total: 0 },
      "understanding",
      0,
    ],
    [
      {
        planned: false,
        started: false,
        paused: false,
        achieved: false,
        done: 0,
        total: 0,
        hasInput: false,
      },
      "draft",
      0,
    ],
    [
      { planned: true, started: false, paused: false, achieved: false, done: 0, total: 5 },
      "active",
      0,
    ],
    [
      { planned: true, started: true, paused: false, achieved: false, done: 2, total: 5 },
      "active",
      33,
    ],
    [
      { planned: true, started: true, paused: true, achieved: false, done: 2, total: 5 },
      "paused",
      33,
    ],
    [
      { planned: true, started: true, paused: true, achieved: false, done: 5, total: 5 },
      "paused",
      83,
    ],
    [
      { planned: true, started: true, paused: false, achieved: false, done: 0, total: 0 },
      "active",
      0,
    ],
  ] as const)("%o -> %s", (flags, status, percent) => {
    expect(E.goalSummary(flags)).toEqual({ status, percent });
  });

  it("every lifecycle status has a text label and an explanation", () => {
    for (const s of GOAL_STATUSES) {
      expect(STATUS_LABEL[s].length).toBeGreaterThan(0);
      expect(STATUS_HELP[s].length).toBeGreaterThan(0);
    }
  });

  it("engine progress uses the same rule", () => {
    let g = E.startGoal(E.planGoal(E.newGoal("g"), "phone", E.getPlan("phone")));
    g = { ...g, completed: E.planOf(g).steps.map((s) => s.id) };
    expect(E.progress(g)).toEqual({ done: 5, total: 5, percent: 83 });
    expect(E.progress({ ...g, achieved: true }).percent).toBe(100);
  });
});
