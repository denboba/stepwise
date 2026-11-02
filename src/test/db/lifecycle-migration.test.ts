// @vitest-environment node
// ADR-0001 migration (db/proposed/0005_goal_lifecycle.sql) validated on a disposable PostgreSQL with the
// real earlier migrations: backfill, constraints, RLS, idempotence, app behavior and rollback.
import { describe, expect, it, vi } from "vitest";
import * as E from "@/lib/engine";
import type { Goal } from "@/lib/engine";
import { deriveStatus } from "@/lib/lifecycle";

// Fresh WASM Postgres per test plus seeding through the app (~3 s locally, slower on CI runners).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { LIFECYCLE_NOT_READY, loadGoal, saveChanges, saveWithLifecycle } from "@/lib/goals.server";
import { applyProposed, clientFor, freshDb, sqlAs, type TestDb } from "./pgClient";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UP = "0005_goal_lifecycle.sql";
const DOWN = "0005_goal_lifecycle.down.sql";
type Db = Parameters<typeof loadGoal>[0];
const user = (db: TestDb) => clientFor(db, { role: "authenticated", userId: A }) as unknown as Db;
const admin = (db: TestDb) => clientFor(db, { role: "service_role" }) as unknown as Db;
const service = { role: "service_role" as const };

async function newGoal(db: TestDb): Promise<Goal> {
  const r = await sqlAs(
    db,
    service,
    "INSERT INTO public.goals (user_id) VALUES ($1) RETURNING id",
    [A],
  );
  return loadGoal(user(db), String(r.rows[0]!["id"]));
}
async function save(db: TestDb, before: Goal, after: Goal) {
  await saveChanges(admin(db), A, before, after);
  return loadGoal(user(db), before.id);
}
function fill(g: Goal, id: string): Goal {
  let out = E.setAck(g, id, true);
  for (const it of E.getStep(id, E.planOf(g)).proof)
    out = E.setProof(
      out,
      id,
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
async function doneSteps(db: TestDb, g: Goal) {
  for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
    const f = { ...fill(g, id), timers: { s5: new Date(0).toISOString() } };
    g = await save(db, g, E.submitProof(f, id));
  }
  return g;
}

/** One goal in each status the backfill can derive, created through the real pre-migration save path. */
async function seedLegacyGoals(db: TestDb) {
  const out: Record<string, string> = {};
  out["draft"] = (await newGoal(db)).id;
  let g = await newGoal(db);
  out["understanding"] = (await save(db, g, E.userText(g, "learn the saxophone"))).id;
  g = await newGoal(db);
  g = await save(db, g, E.startGoal(E.sendText(g, "my phone won't charge")));
  out["active"] = g.id;
  g = await newGoal(db);
  g = await save(db, g, E.startGoal(E.sendText(g, "my phone won't charge")));
  out["paused"] = (await save(db, g, E.goalPaused(g))).id;
  g = await newGoal(db);
  g = await save(db, g, E.startGoal(E.sendText(g, "my phone won't charge")));
  out["blocked"] = (await save(db, g, E.askReplan({ ...g, replanCount: 3 }, "stuck", "s1"))).id;
  g = await newGoal(db);
  g = await doneSteps(db, await save(db, g, E.startGoal(E.sendText(g, "my phone won't charge"))));
  out["verifying"] = g.id;
  const base = Number(g.proofs["s5"]?.["before"]);
  g = await newGoal(db);
  g = await doneSteps(db, await save(db, g, E.startGoal(E.sendText(g, "my phone won't charge"))));
  out["unresolved"] = (
    await save(db, g, E.askReplan(E.submitCheck(E.setCheckValue(g, String(base))), "check"))
  ).id;
  g = await newGoal(db);
  g = await doneSteps(db, await save(db, g, E.startGoal(E.sendText(g, "my phone won't charge"))));
  out["achieved"] = (await save(db, g, E.submitCheck(E.setCheckValue(g, String(base + 5))))).id;
  return out;
}

const statusOf = async (db: TestDb, id: string) =>
  (await sqlAs(db, service, "SELECT status, status_reason FROM public.goals WHERE id = $1", [id]))
    .rows[0];

describe("0005_goal_lifecycle migration", () => {
  it("backfills every existing goal to the status the app derives", async () => {
    const db = await freshDb();
    const ids = await seedLegacyGoals(db);
    const before = await sqlAs(db, service, "SELECT count(*)::int AS n FROM public.goals");
    await applyProposed(db, UP);
    const after = await sqlAs(db, service, "SELECT count(*)::int AS n FROM public.goals");
    expect(after.rows[0]?.["n"]).toBe(before.rows[0]?.["n"]); // no rows lost or added
    for (const [expected, id] of Object.entries(ids)) {
      const row = await statusOf(db, id);
      expect(row?.["status"], expected).toBe(expected);
      const loaded = await loadGoal(user(db), id);
      expect(deriveStatus(loaded, Date.now()), expected).toBe(expected);
    }
    // The checklist-complete goal is not reported as achieved.
    expect((await statusOf(db, ids["verifying"]!))?.["status"]).toBe("verifying");
  });

  it("rejects unknown statuses and over-long reasons", async () => {
    const db = await freshDb();
    await applyProposed(db, UP);
    const g = await newGoal(db);
    const bad = await sqlAs(db, service, "UPDATE public.goals SET status = 'done' WHERE id = $1", [
      g.id,
    ]);
    expect(bad.error?.code).toBe("23514");
    const long = await sqlAs(
      db,
      service,
      "UPDATE public.goals SET status_reason = $2 WHERE id = $1",
      [g.id, "x".repeat(501)],
    );
    expect(long.error?.code).toBe("23514");
  });

  it("signed-in users still can't write a status (no new policies)", async () => {
    const db = await freshDb();
    await applyProposed(db, UP);
    const g = await newGoal(db);
    const r = await sqlAs(
      db,
      { role: "authenticated", userId: A },
      "UPDATE public.goals SET status = 'achieved' WHERE id = $1",
      [g.id],
    );
    expect(r.affected).toBe(0);
    expect((await statusOf(db, g.id))?.["status"]).toBe("draft");
  });

  it("is idempotent and never overwrites statuses the app wrote", async () => {
    const db = await freshDb();
    await applyProposed(db, UP);
    const g = await newGoal(db);
    const r = await saveWithLifecycle(admin(db), A, g, E.postLine(g, "Goal ended."), {
      type: "end",
      reason: "Changed my mind",
    });
    expect(r.ok).toBe(true);
    await applyProposed(db, UP);
    expect(await statusOf(db, g.id)).toEqual({
      status: "abandoned",
      status_reason: "Changed my mind",
    });
  });

  it("rollback drops the columns and the app keeps working on derived statuses", async () => {
    const db = await freshDb();
    await applyProposed(db, UP);
    let g = await newGoal(db);
    g = await save(db, g, E.startGoal(E.sendText(g, "my phone won't charge")));
    expect(g.lifecyclePersisted).toBe(true);
    await applyProposed(db, DOWN);
    const cols = await sqlAs(
      db,
      service,
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'goals' AND column_name LIKE 'status%'",
    );
    expect(cols.rows).toEqual([]);
    const reloaded = await loadGoal(user(db), g.id);
    expect(reloaded.lifecyclePersisted).toBeUndefined();
    expect(reloaded.status).toBe("active");
    const next = E.submitProof(fill(reloaded, "s1"), "s1");
    expect((await saveWithLifecycle(admin(db), A, reloaded, next)).ok).toBe(true);
    expect((await loadGoal(user(db), g.id)).completed).toEqual(["s1"]);
  });
});

describe("app behavior with and without the lifecycle columns", () => {
  it("without the migration: normal saves work, ending is refused clearly", async () => {
    const db = await freshDb();
    let g = await newGoal(db);
    expect(g.lifecyclePersisted).toBeUndefined();
    expect(
      (
        await saveWithLifecycle(
          admin(db),
          A,
          g,
          E.startGoal(E.sendText(g, "my phone won't charge")),
        )
      ).ok,
    ).toBe(true);
    g = await loadGoal(user(db), g.id);
    expect(g.status).toBe("active");
    const r = await saveWithLifecycle(admin(db), A, g, g, { type: "end", reason: "Not needed" });
    expect(r).toEqual({ ok: false, reason: LIFECYCLE_NOT_READY });
  });

  it("with the migration: status is persisted on every save and ended goals stay ended", async () => {
    const db = await freshDb();
    await applyProposed(db, UP);
    let g = await newGoal(db);
    await saveWithLifecycle(admin(db), A, g, E.startGoal(E.sendText(g, "my phone won't charge")));
    g = await loadGoal(user(db), g.id);
    expect((await statusOf(db, g.id))?.["status"]).toBe("active");

    await saveWithLifecycle(admin(db), A, g, E.postLine(g, "Goal ended."), {
      type: "end",
      reason: "Phone replaced under warranty",
    });
    g = await loadGoal(user(db), g.id);
    expect(g.status).toBe("abandoned");
    expect(g.statusReason).toBe("Phone replaced under warranty");
    expect(g.achieved).toBe(false);
    // A later save can't silently revive or "achieve" it.
    await saveWithLifecycle(admin(db), A, g, E.postLine(g, "noise"));
    expect((await statusOf(db, g.id))?.["status"]).toBe("abandoned");
  });

  it("escalation holds across reloads until the user resolves it", async () => {
    const db = await freshDb();
    await applyProposed(db, UP);
    let g = await newGoal(db);
    await saveWithLifecycle(admin(db), A, g, E.startGoal(E.sendText(g, "my phone won't charge")));
    g = await loadGoal(user(db), g.id);
    await saveWithLifecycle(admin(db), A, g, E.postLine(g, "Safety first"), {
      type: "escalate",
      reason: "Fire, smoke or sparks",
    });
    g = await loadGoal(user(db), g.id);
    expect(g.status).toBe("escalated");
    expect(g.statusReason).toBe("Fire, smoke or sparks");
    await saveWithLifecycle(admin(db), A, g, E.continueWith(g, "Continuing."), {
      type: "resolveEscalation",
    });
    g = await loadGoal(user(db), g.id);
    expect(g.status).toBe("active");
    expect(await statusOf(db, g.id)).toEqual({ status: "active", status_reason: null });
  });

  it("a completed checklist persists as 'verifying'; only a passed check persists 'achieved'", async () => {
    const db = await freshDb();
    await applyProposed(db, UP);
    let g = await newGoal(db);
    await saveWithLifecycle(admin(db), A, g, E.startGoal(E.sendText(g, "my phone won't charge")));
    g = await loadGoal(user(db), g.id);
    for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
      const f = { ...fill(g, id), timers: { s5: new Date(0).toISOString() } };
      await saveWithLifecycle(admin(db), A, g, E.submitProof(f, id));
      g = await loadGoal(user(db), g.id);
    }
    expect((await statusOf(db, g.id))?.["status"]).toBe("verifying");
    const base = Number(g.proofs["s5"]?.["before"]);
    await saveWithLifecycle(
      admin(db),
      A,
      g,
      E.askReplan(E.submitCheck(E.setCheckValue(g, String(base))), "check"),
    );
    g = await loadGoal(user(db), g.id);
    expect((await statusOf(db, g.id))?.["status"]).toBe("unresolved");
    await saveWithLifecycle(admin(db), A, g, E.retryCheck(g));
    g = await loadGoal(user(db), g.id);
    await saveWithLifecycle(admin(db), A, g, E.submitCheck(E.setCheckValue(g, String(base + 5))));
    expect((await statusOf(db, g.id))?.["status"]).toBe("achieved");
  });
});
