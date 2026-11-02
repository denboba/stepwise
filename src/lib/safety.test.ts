// P1 Increment 3 (spec R6): deterministic life-safety gate. Also the first regression tests for the
// code-defined red flags in casefw.ts.
import { describe, expect, it } from "vitest";
import * as E from "./engine";
import { gateText, stopWork, stopWorkLine } from "./safety";
import { wordCount } from "./text";

describe("life-safety red flags stop work", () => {
  it.each([
    ["My chest hurts and I can't catch my breath", "Chest pain"],
    ["I can't breathe properly", "Chest pain"],
    ["I want to kill myself", "suicide"],
    ["I've been thinking about self-harm", "suicide"],
    ["I smell gas in the kitchen", "gas"],
    ["My CO alarm is beeping and I feel dizzy", "gas"],
    ["The carbon monoxide detector went off", "gas"],
    ["There is smoke coming from my laptop charger", "smoke"],
    ["Sparks coming from the wall socket", "smoke"],
    ["My toaster caught fire", "smoke"],
    ["My toddler swallowed a battery", "bleeding"],
    ["The cut won't stop bleeding", "bleeding"],
    ["My dad is unconscious", "bleeding"],
  ])("%s", (text, signPart) => {
    const flag = stopWork(text);
    expect(flag?.life_safety).toBe(true);
    expect(flag?.sign.toLowerCase()).toContain(signPart.toLowerCase());
  });

  it.each([
    "Install a carbon monoxide detector in my flat",
    "Set up a CO alarm",
    "Fix my gas grill burner",
    "My laptop randomly shuts off when gaming",
    "Build a fire pit in the garden",
    "Fix my chest of drawers",
    "Train for a 5k without getting out of breath",
    "Learn first aid for seizures",
    "Wire an LED to an Arduino",
    "Learn to play the saxophone",
    "My phone won't charge",
    "Replace the battery in my smoke alarm",
  ])("ordinary goal passes: %s", (text) => {
    expect(stopWork(text)).toBeNull();
  });

  it("every stop-work line fits 25 words", () => {
    const samples = [
      "My chest hurts and I can't breathe",
      "I want to kill myself",
      "I smell gas",
      "Smoke coming from the outlet",
      "My toddler swallowed a battery",
    ];
    for (const s of samples) {
      const flag = stopWork(s);
      expect(flag).not.toBeNull();
      expect(wordCount(stopWorkLine(flag!))).toBeLessThanOrEqual(25);
    }
  });
});

describe("gateText", () => {
  it("records the user's text and one stop-work line, nothing else", () => {
    const before = E.startGoal(E.planGoal(E.newGoal("g"), "phone", E.getPlan("phone")));
    const hit = gateText(before, "Sparks coming from the charger now");
    expect(hit?.sign).toBe("Fire, smoke or sparks");
    const after = hit?.goal;
    expect(after).toBeDefined();
    const added = after!.messages.slice(before.messages.length);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ role: "user", kind: "text" });
    expect(added[1]).toMatchObject({ role: "assistant", kind: "text" });
    expect((added[1] as { text: string }).text).toMatch(/^Safety first:/);
    const { messages: _a, seq: _b, ...restAfter } = after!;
    const { messages: _c, seq: _d, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);
  });

  it("applies before a plan exists (no intake or plan is started)", () => {
    const after = gateText(E.newGoal("g"), "I smell gas, how do I fix the stove?")?.goal;
    expect(after?.planned).toBe(false);
    expect(after?.messages).toHaveLength(2);
  });

  it("lets ordinary text through", () => {
    expect(gateText(E.newGoal("g"), "Help me learn to solder")).toBeNull();
  });
});
