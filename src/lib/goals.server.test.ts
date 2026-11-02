// P1 Increment 2 (spec R5, R10): persistence integrity of saveChanges/loadGoal against an in-memory
// fake that enforces primary keys. RLS and real Postgres behavior are covered later by spec R8.
import { describe, expect, it } from "vitest";
import * as E from "./engine";
import type { Goal } from "./engine";
import { StaleGoalError, loadGoal, saveChanges } from "./goals.server";
import { fakeSupabase } from "@/test/fakeSupabase";

const G = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const PHONE_GOAL = "my phone won't charge";

type Db = Parameters<typeof loadGoal>[0];

function setup(extra: Record<string, Record<string, unknown>[]> = {}) {
  const fake = fakeSupabase({
    goals: [
      {
        id: G,
        user_id: U,
        seq: 0,
        planned: false,
        started: false,
        achieved: false,
        paused: false,
        custom: false,
        intake: [],
        replan_count: 0,
        template_id: null,
        case_data: null,
        title: null,
        goal_text: null,
        done_means: null,
        check_def: null,
      },
    ],
    ...extra,
  });
  const db = fake.client as unknown as Db;
  return { fake, db, load: () => loadGoal(db, G) };
}

/** Fills every proof item of a step with a value the engine accepts. */
function fillProof(g: Goal, stepId: string): Goal {
  const step = E.getStep(stepId, E.planOf(g));
  let out = E.setAck(g, stepId, true);
  for (const it of step.proof) {
    const v =
      it.kind === "check"
        ? true
        : it.kind === "passfail"
          ? "pass"
          : it.kind === "number"
            ? String(it.min ?? it.max ?? 1)
            : it.kind === "photo"
              ? `${U}/${G}/p.jpg`
              : "ok";
    out = E.setProof(out, stepId, it.id, v);
  }
  return out;
}

describe("saveChanges claims the goal before writing (compare-and-set on seq)", () => {
  it("the first write is the seq claim, scoped to the goal and the loaded seq", async () => {
    const { fake, db, load } = setup();
    const before = await load();
    const after = E.sendText(before, PHONE_GOAL);
    await saveChanges(db, U, before, after);
    const [first] = fake.writes();
    expect(first).toMatchObject({ table: "goals", op: "update" });
    expect(first!.filters).toEqual([
      { col: "id", kind: "eq", value: G },
      { col: "seq", kind: "eq", value: before.seq },
    ]);
  });

  it("a lost claim writes nothing else and throws StaleGoalError", async () => {
    const { fake, db, load } = setup();
    const before = await load();
    fake.rows("goals")[0]!["seq"] = 7; // another device saved first
    const after = E.sendText(before, PHONE_GOAL);
    await expect(saveChanges(db, U, before, after)).rejects.toBeInstanceOf(StaleGoalError);
    expect(fake.writes()).toHaveLength(1);
    expect(fake.rows("goal_steps")).toHaveLength(0);
    expect(fake.rows("messages")).toHaveLength(0);
    expect(fake.rows("goals")[0]).toMatchObject({ seq: 7, planned: false });
  });

  it("a double submission of the same proof saves once; the second is stale", async () => {
    const { fake, db, load } = setup();
    let g = await load();
    await saveChanges(db, U, g, E.startGoal(E.sendText(g, PHONE_GOAL)));
    g = await load();
    const a = fillProof(g, "s1");
    const first = E.submitProof(a, "s1");
    const second = E.submitProof(a, "s1");
    await saveChanges(db, U, g, first);
    const messagesAfterFirst = fake.rows("messages").length;
    await expect(saveChanges(db, U, g, second)).rejects.toBeInstanceOf(StaleGoalError);
    expect(fake.rows("messages")).toHaveLength(messagesAfterFirst);
    expect((await load()).completed).toEqual(["s1"]);
  });
});

describe("an interrupted first plan can be retried (no manual repair)", () => {
  it("clears rows left by an earlier attempt before inserting", async () => {
    const debris = {
      goal_id: G,
      user_id: U,
      step_key: "s1",
      position: 0,
      title: "old",
      minutes: 1,
    };
    const { fake, db, load } = setup({
      goal_steps: [debris],
      proof_items: [
        {
          goal_id: G,
          user_id: U,
          step_key: "s1",
          item_key: "off",
          position: 0,
          label: "x",
          kind: "check",
        },
      ],
    });
    const before = await load();
    await saveChanges(db, U, before, E.sendText(before, PHONE_GOAL));
    const plan = E.getPlan("phone");
    expect(fake.rows("goal_steps")).toHaveLength(plan.steps.length);
    expect(fake.rows("goal_steps").find((s) => s["step_key"] === "s1")?.["title"]).toBe(
      plan.steps[0]!.title,
    );
  });

  it("a failure after the plan rows were written, then a retry, ends planned and consistent", async () => {
    const { fake, db, load } = setup();
    const before = await load();
    fake.failNext("messages", "insert");
    await expect(saveChanges(db, U, before, E.sendText(before, PHONE_GOAL))).rejects.toBeTruthy();

    // State after the crash: plan rows exist, goal still unplanned, seq advanced (a harmless gap).
    const crashed = await load();
    expect(crashed.planned).toBe(false);
    expect(fake.rows("goal_steps").length).toBeGreaterThan(0);

    await saveChanges(db, U, crashed, E.sendText(crashed, PHONE_GOAL));
    const g = await load();
    expect(g.planned).toBe(true);
    expect(E.planOf(g).steps.map((s) => s.id)).toEqual(E.getPlan("phone").steps.map((s) => s.id));
    expect(g.messages.filter((m) => m.kind === "goal")).toHaveLength(1);
  });
});

describe("resume: a saved goal reloads with the same progress (R10)", () => {
  it("plan, completed step, proof and messages survive a reload", async () => {
    const { db, load } = setup();
    let g = await load();
    const started = E.startGoal(E.sendText(g, PHONE_GOAL));
    await saveChanges(db, U, g, started);
    g = await load();
    const done = E.submitProof(fillProof(g, "s1"), "s1");
    await saveChanges(db, U, g, done);

    const reloaded = await load();
    expect(reloaded.started).toBe(true);
    expect(reloaded.completed).toEqual(["s1"]);
    expect(reloaded.proofs["s1"]).toEqual(done.proofs["s1"]);
    expect(reloaded.ack["s1"]).toBe(true);
    expect(reloaded.seq).toBe(done.seq);
    expect(reloaded.messages.map((m) => m.kind)).toEqual(done.messages.map((m) => m.kind));
    expect(E.availableSteps(reloaded.completed, E.planOf(reloaded))).toEqual(
      E.availableSteps(done.completed, E.planOf(done)),
    );
  });

  it("unsubmitted proof is never saved as progress", async () => {
    const { fake, db, load } = setup();
    const g = await load();
    await saveChanges(db, U, g, E.startGoal(E.sendText(g, PHONE_GOAL)));
    const g2 = await load();
    // Typed but not submitted: the engine state carries the draft, but nothing is completed.
    const draft = fillProof(g2, "s1");
    await saveChanges(db, U, g2, E.sendText(draft, "hello"));
    expect(fake.rows("proof_submissions")).toHaveLength(0);
    expect((await load()).completed).toEqual([]);
  });
});
