// @vitest-environment node
// Spec R9: reference journeys through the REAL server handlers (actions.server.ts) on a disposable
// PostgreSQL with the real migrations (plus the proposed lifecycle migration), with a scripted AI.
// Each journey covers investigation, planning, guidance, observations, a failure, a replan, an
// interruption (fresh handlers + reload from the database) and verification of the outcome.
import { describe, expect, it, vi } from "vitest";
import * as E from "@/lib/engine";
import type { AiPlan, Goal, IntakeAnswer } from "@/lib/engine";

// Whole journeys on a fresh WASM Postgres (~2 s locally, slower on CI runners).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { NotFound, loadGoal } from "@/lib/goals.server";
import {
  actionSchema,
  runGoalAction,
  runSubmitGoalCheck,
  runSubmitProof,
  type ActionResult,
  type AiPort,
  type Deps,
} from "@/lib/actions.server";
import { AiCallError } from "@/lib/ai.server";
import { applyProposed, clientFor, freshDb, sqlAs, type TestDb } from "./pgClient";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
type Db = Parameters<typeof loadGoal>[0];

// ---------------------------------------------------------------- scripted AI

type Call = { mode: keyof AiPort; args: unknown[] };
/** Each AI method answers from its own queue; an unexpected call fails the test. */
function scriptedAi(script: Partial<Record<keyof AiPort, unknown[]>>) {
  const calls: Call[] = [];
  const next = (mode: keyof AiPort, args: unknown[]) => {
    calls.push({ mode, args });
    const q = script[mode];
    if (!q?.length) throw new Error(`Unexpected AI call: ${mode}`);
    const r = q.shift();
    if (r instanceof Error) throw r;
    return typeof r === "function" ? (r as (...a: unknown[]) => unknown)(...args) : r;
  };
  const ai = {
    aiIntake: async (...a: unknown[]) => next("aiIntake", a),
    aiPlan: async (...a: unknown[]) => next("aiPlan", a),
    aiReplan: async (...a: unknown[]) => next("aiReplan", a),
    aiSideQuestion: async (...a: unknown[]) => next("aiSideQuestion", a),
    aiHint: async (...a: unknown[]) => next("aiHint", a),
    aiPhotoCheck: async (...a: unknown[]) => next("aiPhotoCheck", a),
  } as unknown as AiPort;
  return { ai, calls, left: () => Object.values(script).reduce((n, q) => n + (q?.length ?? 0), 0) };
}

type Step = AiPlan["steps"][number];
const step = (id: string, title: string, prereqs: string[], proof: Step["proof"]): Step => ({
  id,
  title,
  est_minutes: 10,
  safety_note: null,
  actions: [`Do: ${title}`],
  why: "Narrows down the cause.",
  hint: "Go slowly and note what you see.",
  prerequisites: prereqs,
  proof,
  wait_seconds: null,
});
const num = (label: string, min: number | null = null, max: number | null = null) => ({
  label,
  type: "number",
  min,
  max,
});
const pf = (label: string) => ({ label, type: "passfail", min: null, max: null });
const text = (label: string) => ({ label, type: "text", min: null, max: null });

// ---------------------------------------------------------------- driver

function session(
  db: TestDb,
  userId: string,
  ai: AiPort,
  clock = { t: Date.parse("2026-11-02T10:00:00Z") },
) {
  const deps: Deps = {
    userDb: clientFor(db, { role: "authenticated", userId }) as unknown as Db,
    admin: clientFor(db, { role: "service_role" }) as unknown as Db,
    userId,
    ai,
    now: () => clock.t,
  };
  const ok = (r: ActionResult): Goal => {
    if (!r.ok) throw new Error(`Refused: ${r.reason}`);
    return r.goal;
  };
  return {
    deps,
    act: (goalId: string, action: Parameters<typeof runGoalAction>[1]["action"]) =>
      runGoalAction(deps, { goalId, action }),
    say: async (goalId: string, t: string) =>
      ok(await runGoalAction(deps, { goalId, action: { type: "text", text: t } })),
    proof: (goalId: string, stepId: string, values: Record<string, string | boolean>) =>
      runSubmitProof(deps, { goalId, stepId, acknowledged: true, values }),
    check: (goalId: string, answers: Record<string, "pass" | "fail">) =>
      runSubmitGoalCheck(deps, { goalId, answers }),
    load: (goalId: string) => loadGoal(deps.userDb, goalId),
    ok,
  };
}

async function newGoalId(db: TestDb, userId: string) {
  const r = await sqlAs(
    db,
    { role: "service_role" },
    "INSERT INTO public.goals (user_id) VALUES ($1) RETURNING id",
    [userId],
  );
  return String(r.rows[0]!["id"]);
}
const texts = (g: Goal) =>
  g.messages.flatMap((m) => (m.kind === "text" ? [`${m.role}: ${m.text}`] : []));
const kinds = (g: Goal) => g.messages.map((m) => m.kind);
const lastPatchId = (g: Goal) => {
  const m = [...g.messages].reverse().find((x) => x.kind === "patch");
  if (!m || m.kind !== "patch") throw new Error("no patch card");
  return m.patchId;
};
const count = async (db: TestDb, sql: string, params: unknown[]) =>
  Number((await sqlAs(db, { role: "service_role" }, sql, params)).rows[0]?.["n"]);

// ---------------------------------------------------------------- journeys

describe("Journey 1: troubleshooting a laptop that shuts down (failure, safety hold, replan, reload)", () => {
  it("investigates, plans, records a failed attempt, replans, survives a reload and verifies", async () => {
    const db = await freshDb();
    await applyProposed(db, "0005_goal_lifecycle.sql");
    const plan: AiPlan = {
      goal: "Laptop stays on during 30 minutes of gaming",
      done_means: "30 minutes of the usual game with no shutdown",
      steps: [
        step(
          "t1",
          "Measure CPU temperature under load",
          [],
          [num("Peak CPU temperature (°C)", 0, 120), pf("Reading taken from a monitoring app")],
        ),
        step(
          "t2",
          "Clean the air vents with compressed air",
          ["t1"],
          [pf("Air flows from the exhaust vent"), text("What came out")],
        ),
        step(
          "t3",
          "Re-test temperature under load",
          ["t2"],
          [
            num("Peak CPU temperature after cleaning (°C)", 0, 120),
            pf("No shutdown during the test"),
          ],
        ),
        step(
          "t4",
          "Check the charger and battery health report",
          ["t1"],
          [pf("Battery report generated"), text("Design vs full charge capacity")],
        ),
      ],
      goal_check: [pf("30 minutes of gaming without a shutdown")],
    };
    const answersSeen: IntakeAnswer[][] = [];
    const s = scriptedAi({
      aiIntake: [
        (_u: unknown, _g: unknown, goal: unknown, answers: unknown) => {
          answersSeen.push(answers as IntakeAnswer[]);
          expect(goal).toBe("My laptop randomly shuts off");
          return {
            question: "Does it lose power instantly or show a shutdown screen?",
            options: ["Instantly", "Shutdown screen"],
          };
        },
        (_u: unknown, _g: unknown, _goal: unknown, answers: unknown) => {
          answersSeen.push(answers as IntakeAnswer[]);
          return {
            question: "When does it happen?",
            options: ["While gaming", "At idle", "Random"],
          };
        },
        (_u: unknown, _g: unknown, _goal: unknown, answers: unknown) => {
          answersSeen.push(answers as IntakeAnswer[]);
          return { ready: true };
        },
      ],
      aiPlan: [plan],
      aiReplan: [
        (_u: unknown, _g: unknown, _p: unknown, status: unknown, _q: unknown, answer: unknown) => {
          // The model sees which steps are done and what the user said; it may only patch open steps.
          expect((status as Record<string, string>)["t1"]).toBe("done");
          expect(answer).toMatch(/still 98/);
          return {
            add_steps: [
              step(
                "t5",
                "Set a balanced power plan and cap the frame rate",
                ["t1"],
                [
                  pf("Frame-rate cap set to 60"),
                  num("Peak CPU temperature with the cap (°C)", 0, 120),
                ],
              ),
            ],
            modify_steps: [],
            remove_steps: [],
            reason: "Cleaning didn't lower the temperature; reduce the load instead.",
          };
        },
        {
          add_steps: [
            step(
              "t6",
              "Run the stress test for 30 minutes on the charger",
              ["t5"],
              [pf("No shutdown during 30 minutes"), num("Peak temperature (°C)", 0, 120)],
            ),
          ],
          modify_steps: [],
          remove_steps: [],
          reason: "The check failed; verify stability under a controlled load first.",
        },
      ],
    });
    const goalId = await newGoalId(db, A);
    const u = session(db, A, s.ai);

    // Investigate: one useful question at a time, never repeating what was answered.
    let g = await u.say(goalId, "My laptop randomly shuts off");
    expect(g.status).toBe("understanding");
    g = await u.say(goalId, "Instantly");
    g = await u.say(goalId, "While gaming");
    expect(answersSeen.map((a) => a.length)).toEqual([0, 1, 2]);
    expect(answersSeen[2]).toEqual([
      { q: "Does it lose power instantly or show a shutdown screen?", a: "Instantly" },
      { q: "When does it happen?", a: "While gaming" },
    ]);
    const asked = g.messages
      .filter((m) => m.kind === "intake")
      .map((m) => (m as { question: string }).question);
    expect(new Set(asked).size).toBe(asked.length);
    expect(g.planned).toBe(true);
    expect(g.status).toBe("active");

    // Guide and observe: the measurement is stored as submitted, not invented.
    g = u.ok(await u.act(goalId, { type: "start" }));
    const bad = await u.proof(goalId, "t1", { p1: "abc", p2: "pass" });
    expect(bad).toMatchObject({ ok: false });
    g = u.ok(await u.proof(goalId, "t1", { p1: "98", p2: "pass" }));
    expect(g.proofs["t1"]).toEqual({ p1: "98", p2: "pass" });
    g = u.ok(await u.proof(goalId, "t2", { p1: "pass", p2: "A lot of dust" }));

    // Safety: smoke stops everything before any AI call and holds the goal across reloads.
    const aiCallsBefore = s.calls.length;
    g = await u.say(goalId, "Now there's smoke coming from the charger");
    expect(s.calls.length).toBe(aiCallsBefore);
    expect(g.status).toBe("escalated");
    expect(texts(g).at(-1)).toMatch(/^assistant: Safety first: Fire, smoke or sparks/);
    expect(await u.proof(goalId, "t3", { p1: "70", p2: "pass" })).toMatchObject({ ok: false });
    g = await u.say(goalId, "what next?");
    expect(texts(g).at(-1)).toMatch(/on hold for safety/);
    expect(s.calls.length).toBe(aiCallsBefore);
    g = u.ok(await u.act(goalId, { type: "resolveEscalation" }));
    expect(g.status).toBe("active");

    // Failure: the user reports the fix didn't work; Stepwise asks what happened, then replans.
    g = await u.say(goalId, "It didn't work, the temperature is still 98");
    expect(g.messages.at(-1)?.kind).toBe("replanAsk");
    g = await u.say(goalId, "The step didn't work, still 98 degrees");
    const patchId = lastPatchId(g);
    expect(g.patches?.[patchId]?.status).toBe("pending");
    expect(E.planOf(g).steps.map((x) => x.id)).not.toContain("t5"); // nothing changes until applied
    g = u.ok(await u.act(goalId, { type: "applyPatch", patchId }));
    expect(E.planOf(g).steps.map((x) => x.id)).toContain("t5");
    expect(g.completed).toEqual(["t1", "t2"]); // verified work preserved
    expect(
      await count(db, "SELECT count(*)::int AS n FROM public.plan_revisions WHERE goal_id = $1", [
        goalId,
      ]),
    ).toBe(1);

    // Interruption: a brand-new session (another device) reloads everything from the database.
    const u2 = session(db, A, s.ai);
    g = await u2.load(goalId);
    expect(g.completed).toEqual(["t1", "t2"]);
    expect(g.proofs["t1"]?.["p1"]).toBe("98");
    expect(g.intake).toHaveLength(2);
    for (const [id, vals] of [
      ["t3", { p1: "96", p2: "pass" }],
      ["t4", { p1: "pass", p2: "50 Wh design, 31 Wh full" }],
      ["t5", { p1: "pass", p2: "82" }],
    ] as const)
      g = u2.ok(await u2.proof(goalId, id, vals));

    // Checklist complete is not success.
    expect(g.status).toBe("verifying");
    expect(g.achieved).toBe(false);
    expect(E.progress(g).percent).toBeLessThan(100);

    // Outcome check fails → unresolved, recorded, and recovery starts.
    g = u2.ok(await u2.check(goalId, { c1: "fail" }));
    expect(g.achieved).toBe(false);
    expect(g.status).toBe("unresolved");
    expect(
      await count(
        db,
        "SELECT count(*)::int AS n FROM public.goal_check_results WHERE goal_id = $1 AND NOT passed",
        [goalId],
      ),
    ).toBe(1);
    g = await u2.say(goalId, "Close, but it shut down after 20 minutes");
    g = u2.ok(await u2.act(goalId, { type: "applyPatch", patchId: lastPatchId(g) }));
    expect(g.status).toBe("active");
    g = u2.ok(await u2.proof(goalId, "t6", { p1: "pass", p2: "84" }));
    expect(g.status).toBe("verifying");
    g = u2.ok(await u2.act(goalId, { type: "retry" }));
    g = u2.ok(await u2.check(goalId, { c1: "pass" }));

    expect(g.achieved).toBe(true);
    expect(g.status).toBe("achieved");
    expect(
      (
        await sqlAs(db, { role: "service_role" }, "SELECT status FROM public.goals WHERE id = $1", [
          goalId,
        ])
      ).rows[0]?.["status"],
    ).toBe("achieved");
    expect(s.left()).toBe(0); // every scripted AI answer was used; no unexpected calls
  });
});

describe("Journey 2: building an electronics project (AI outage, invalid plan, no lifecycle columns)", () => {
  it("recovers from an AI outage and an invalid plan without duplicates, then completes", async () => {
    const db = await freshDb(); // lifecycle migration NOT applied: the app must still work
    const valid: AiPlan = {
      goal: "LED night light turns on in the dark",
      done_means: "LED lights within 2 seconds of covering the sensor, off in daylight",
      steps: [
        step(
          "e1",
          "Wire the light sensor to A0",
          [],
          [num("Reading in daylight", 0, 1023), num("Reading covered", 0, 1023)],
        ),
        step(
          "e2",
          "Wire the LED with a 220 Ω resistor to pin 9",
          [],
          [pf("LED lights with the blink sketch"), text("Resistor colour bands")],
        ),
        step(
          "e3",
          "Upload the threshold sketch",
          ["e1", "e2"],
          [pf("LED turns on when covered"), num("Threshold used", 0, 1023)],
        ),
        step(
          "e4",
          "Test in a dark room",
          ["e3"],
          [pf("LED on within 2 seconds"), pf("LED off in daylight")],
        ),
      ],
      goal_check: [pf("Covered: on within 2 s"), pf("Daylight: off")],
    };
    const invalid = { ...valid, steps: valid.steps.slice(0, 2) }; // only 2 steps: fails validation
    const s = scriptedAi({
      aiIntake: [{ ready: true }, { ready: true }],
      aiPlan: [new AiCallError("gateway timeout"), invalid, valid],
    });
    const goalId = await newGoalId(db, A);
    const u = session(db, A, s.ai);

    let g = await u.say(goalId, "Build an LED night light with an Arduino");
    expect(g.messages.at(-1)?.kind).toBe("aiError");
    expect(g.planned).toBe(false);
    g = u.ok(await u.act(goalId, { type: "retryAi" }));
    expect(g.planned).toBe(true);
    expect(
      texts(g).filter((t) => t === "user: Build an LED night light with an Arduino"),
    ).toHaveLength(1);
    expect(kinds(g).filter((k) => k === "aiError")).toHaveLength(0);
    // The second plan call got the validation errors to fix.
    const planCalls = s.calls.filter((c) => c.mode === "aiPlan");
    expect(planCalls).toHaveLength(3);
    expect(planCalls[2]!.args[4]).toEqual(
      expect.arrayContaining([expect.stringMatching(/4 to 10/)]),
    );

    g = u.ok(await u.act(goalId, { type: "start" }));
    expect(E.availableSteps(g.completed, E.planOf(g)).sort()).toEqual(["e1", "e2"]); // parallel
    expect(await u.proof(goalId, "e3", { p1: "pass", p2: "400" })).toMatchObject({ ok: false }); // locked
    g = u.ok(await u.proof(goalId, "e1", { p1: "780", p2: "120" }));
    g = u.ok(await u.proof(goalId, "e2", { p1: "pass", p2: "red red brown" }));
    g = u.ok(await u.proof(goalId, "e3", { p1: "pass", p2: "400" }));
    g = u.ok(await u.proof(goalId, "e4", { p1: "pass", p2: "pass" }));
    expect(g.status).toBe("verifying");
    expect(g.lifecyclePersisted).toBeUndefined();
    // Ending needs the migration; the refusal is explicit.
    expect(await u.act(goalId, { type: "end", reason: "testing" })).toMatchObject({ ok: false });
    g = u.ok(await u.check(goalId, { c1: "pass", c2: "pass" }));
    expect(g.achieved).toBe(true);
    expect(s.left()).toBe(0);
  });
});

describe("Journey 3: learning a skill (routing, failed plan recovery, user ends the goal)", () => {
  it("keeps the user's added detail after a failed plan, then records an honest end", async () => {
    const db = await freshDb();
    await applyProposed(db, "0005_goal_lifecycle.sql");
    const learn: AiPlan = {
      goal: "Play a one-octave B♭ major scale on the saxophone",
      done_means: "Scale at 60 bpm with no squeaks, twice in a row",
      steps: [
        step(
          "l1",
          "Assemble the sax and wet the reed",
          [],
          [pf("Reed sits flat on the mouthpiece"), text("Reed strength")],
        ),
        step("l2", "Long tones on G", ["l1"], [num("Seconds held steady", 1, 60), pf("No squeak")]),
        step(
          "l3",
          "Learn the B♭ scale fingerings",
          ["l1"],
          [pf("Fingerings played slowly"), text("Hardest note")],
        ),
        step(
          "l4",
          "Scale with a metronome at 60 bpm",
          ["l2", "l3"],
          [pf("Two clean runs"), num("Metronome bpm", 40, 200)],
        ),
      ],
      goal_check: [pf("Scale at 60 bpm twice without squeaks")],
    };
    const goalsSeen: string[] = [];
    const answersSeen: IntakeAnswer[][] = [];
    const s = scriptedAi({
      aiIntake: [
        { question: "Do you have a saxophone and reeds?", options: ["Yes", "Renting soon"] },
        (_u: unknown, _g: unknown, goal: unknown, answers: unknown) => {
          goalsSeen.push(goal as string);
          answersSeen.push(answers as IntakeAnswer[]);
          return { ready: true };
        },
        (_u: unknown, _g: unknown, goal: unknown, answers: unknown) => {
          goalsSeen.push(goal as string);
          answersSeen.push(answers as IntakeAnswer[]);
          return { ready: true };
        },
      ],
      aiPlan: [{ bad: true }, { still: "bad" }, learn],
    });
    const goalId = await newGoalId(db, A);
    const u = session(db, A, s.ai);

    let g = await u.say(goalId, "I want to learn the saxophone");
    expect(g.planId).toBeUndefined(); // not hijacked by the phone-charging template
    g = await u.say(goalId, "Yes, an alto");
    expect(texts(g).at(-1)).toBe(`assistant: ${E.PLAN_FAILED_LINE}`);
    expect(g.planned).toBe(false);
    g = await u.say(goalId, "I'm a complete beginner and can practise 20 minutes a day");
    // The original goal and the new detail both reach the AI.
    expect(goalsSeen.at(-1)).toBe("I want to learn the saxophone");
    expect(answersSeen.at(-1)).toEqual([
      { q: "Do you have a saxophone and reeds?", a: "Yes, an alto" },
      { q: E.EXTRA_DETAIL_Q, a: "I'm a complete beginner and can practise 20 minutes a day" },
    ]);
    expect(g.planned).toBe(true);

    g = u.ok(await u.act(goalId, { type: "start" }));
    g = u.ok(await u.proof(goalId, "l1", { p1: "pass", p2: "2.5" }));
    // The user decides to stop. The record says so, honestly, and nothing more can be marked done.
    // The server-function boundary rejects a reason under 3 characters before any handler runs.
    expect(actionSchema.safeParse({ goalId, action: { type: "end", reason: " x " } }).success).toBe(
      false,
    );
    g = u.ok(await u.act(goalId, { type: "end", reason: "Switching to clarinet lessons" }));
    expect(g.status).toBe("abandoned");
    expect(g.statusReason).toBe("Switching to clarinet lessons");
    expect(g.achieved).toBe(false);
    expect(await u.proof(goalId, "l2", { p1: "10", p2: "pass" })).toMatchObject({ ok: false });
    expect(await u.act(goalId, { type: "text", text: "hello?" })).toMatchObject({ ok: false });
    expect(await u.act(goalId, { type: "resolveEscalation" })).toMatchObject({ ok: false });
    const reloaded = await session(db, A, s.ai).load(goalId);
    expect(reloaded.status).toBe("abandoned");
    expect(reloaded.completed).toEqual(["l1"]);
    expect(s.left()).toBe(0);
  });
});

describe("authorization through the real handlers", () => {
  it("another user can't read or act on the goal", async () => {
    const db = await freshDb();
    const s = scriptedAi({});
    const goalId = await newGoalId(db, A);
    const b = session(db, B, s.ai);
    await expect(b.say(goalId, "my phone won't charge")).rejects.toBeInstanceOf(NotFound);
    await expect(b.proof(goalId, "s1", { off: true })).rejects.toBeInstanceOf(NotFound);
    await expect(b.check(goalId, { c1: "pass" })).rejects.toBeInstanceOf(NotFound);
    expect(
      await count(db, "SELECT count(*)::int AS n FROM public.messages WHERE goal_id = $1", [
        goalId,
      ]),
    ).toBe(0);
    expect(s.calls).toHaveLength(0);
  });
});
