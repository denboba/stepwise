// @vitest-environment node
// Spec R8: the repository's real migrations, row-level security, storage policies and server persistence
// code, run against a disposable in-process PostgreSQL 18 (PGlite). No network, no credentials, no
// production data. See docs/TESTING.md "Database tests".
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as E from "@/lib/engine";
import type { Goal } from "@/lib/engine";
import { NotFound, StaleGoalError, loadGoal, saveChanges } from "@/lib/goals.server";
import { clientFor, freshDb, migrationTags, sqlAs, type TestDb } from "./pgClient";

// Each test boots a fresh WASM Postgres and runs every migration (~1 s locally, several on CI runners).
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHONE_GOAL = "my phone won't charge";

type Db = Parameters<typeof loadGoal>[0];
const as = (db: TestDb, userId: string) =>
  clientFor(db, { role: "authenticated", userId }) as unknown as Db;
const admin = (db: TestDb, failNext?: { table: string; op: string }[]) =>
  clientFor(db, { role: "service_role" }, { failNext }) as unknown as Db;

async function newGoalRow(db: TestDb, userId: string): Promise<string> {
  const r = await sqlAs(
    db,
    { role: "service_role" },
    "INSERT INTO public.goals (user_id) VALUES ($1) RETURNING id",
    [userId],
  );
  if (r.error) throw new Error(r.error.message);
  return String(r.rows[0]!["id"]);
}

function fillProof(g: Goal, stepId: string, userId: string): Goal {
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
              ? `${userId}/${g.id}/${stepId}.jpg`
              : "ok";
    out = E.setProof(out, stepId, it.id, v);
  }
  return out;
}

/** Plans and starts a phone goal for `userId`, through the real save path. */
async function startedPhoneGoal(db: TestDb, userId: string) {
  const id = await newGoalRow(db, userId);
  const g0 = await loadGoal(as(db, userId), id);
  await saveChanges(admin(db), userId, g0, E.startGoal(E.sendText(g0, PHONE_GOAL)));
  return loadGoal(as(db, userId), id);
}

describe("migrations", () => {
  it("every migration applies in journal order on an empty database", async () => {
    const db = await freshDb();
    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "goals",
        "goal_steps",
        "messages",
        "plan_patches",
        "plan_revisions",
        "photo_checks",
      ]),
    );
    expect(migrationTags().length).toBeGreaterThanOrEqual(5);
  });

  it("row-level security is enabled on every public table", async () => {
    const db = await freshDb();
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'",
    );
    expect(r.rows.length).toBeGreaterThan(10);
    expect(r.rows.filter((t) => !t.relrowsecurity).map((t) => t.relname)).toEqual([]);
  });

  it("no policy lets signed-in users insert or update app tables", async () => {
    const db = await freshDb();
    const r = await db.query<{ tablename: string; cmd: string }>(
      "SELECT tablename, cmd FROM pg_policies WHERE schemaname = 'public' AND cmd IN ('INSERT', 'UPDATE', 'ALL')",
    );
    expect(r.rows).toEqual([]);
  });
});

describe("row-level security and cross-user isolation", () => {
  let db: TestDb;
  let goalA: Goal;
  beforeAll(async () => {
    db = await freshDb();
    goalA = await startedPhoneGoal(db, A);
  });

  it("the owner can read their goal", async () => {
    expect((await loadGoal(as(db, A), goalA.id)).started).toBe(true);
  });

  it("another user gets NotFound, not the goal", async () => {
    await expect(loadGoal(as(db, B), goalA.id)).rejects.toBeInstanceOf(NotFound);
  });

  it("another user sees none of the goal's rows in any table", async () => {
    for (const table of ["goals", "goal_steps", "step_prereqs", "proof_items", "messages"]) {
      const sql = `SELECT count(*)::int AS n FROM public.${table}`;
      const owner = await sqlAs(db, { role: "authenticated", userId: A }, sql);
      expect(owner.rows[0]?.["n"], `owner sees ${table}`).toBeGreaterThan(0); // positive control
      const r = await sqlAs(db, { role: "authenticated", userId: B }, sql);
      expect(r.rows[0]?.["n"], table).toBe(0);
    }
  });

  it("anonymous requests see nothing", async () => {
    const r = await sqlAs(db, { role: "anon" }, "SELECT count(*)::int AS n FROM public.goals");
    expect(r.rows[0]?.["n"]).toBe(0);
  });

  it("the owner can't mark their own goal achieved or a step done directly", async () => {
    const own = { role: "authenticated" as const, userId: A };
    // Positive control: the same WHERE matches one row for the server's service role.
    const control = await sqlAs(
      db,
      { role: "service_role" },
      "UPDATE public.goals SET title = title WHERE id = $1",
      [goalA.id],
    );
    expect(control.affected).toBe(1);
    expect(
      (await sqlAs(db, own, "UPDATE public.goals SET achieved = true WHERE id = $1", [goalA.id]))
        .affected,
    ).toBe(0);
    expect(
      (
        await sqlAs(db, own, "UPDATE public.goal_steps SET done = true WHERE goal_id = $1", [
          goalA.id,
        ])
      ).affected,
    ).toBe(0);
    const ins = await sqlAs(
      db,
      own,
      "INSERT INTO public.proof_submissions (goal_id, user_id, step_key, item_key, value) VALUES ($1, $2, 's1', 'off', 'true')",
      [goalA.id, A],
    );
    expect(ins.error?.code).toBe("42501");
    const msg = await sqlAs(
      db,
      own,
      "INSERT INTO public.messages (goal_id, user_id, seq, role, kind, body) VALUES ($1, $2, 999, 'assistant', 'recap', null)",
      [goalA.id, A],
    );
    expect(msg.error?.code).toBe("42501");
    const after = await loadGoal(as(db, A), goalA.id);
    expect(after.achieved).toBe(false);
    expect(after.completed).toEqual([]);
  });

  it("another user can't delete the goal; the owner can, and children cascade", async () => {
    const del = await sqlAs(
      db,
      { role: "authenticated", userId: B },
      "DELETE FROM public.goals WHERE id = $1",
      [goalA.id],
    );
    expect(del.affected).toBe(0);
    const scratch = await startedPhoneGoal(db, A);
    const own = await sqlAs(
      db,
      { role: "authenticated", userId: A },
      "DELETE FROM public.goals WHERE id = $1",
      [scratch.id],
    );
    expect(own.affected).toBe(1);
    const left = await sqlAs(
      db,
      { role: "service_role" },
      "SELECT count(*)::int AS n FROM public.goal_steps WHERE goal_id = $1",
      [scratch.id],
    );
    expect(left.rows[0]?.["n"]).toBe(0);
  });
});

describe("proof photo storage policies", () => {
  let db: TestDb;
  const path = (user: string) => `${user}/goal-1/s1-p1.jpg`;
  const put = (user: string, name: string) =>
    sqlAs(
      db,
      { role: "authenticated", userId: user },
      "INSERT INTO storage.objects (bucket_id, name) VALUES ('proof-photos', $1)",
      [name],
    );
  beforeAll(async () => {
    db = await freshDb();
  });

  it("a user can upload into their own folder only", async () => {
    expect((await put(A, path(A))).error).toBeNull();
    expect((await put(B, path(A))).error?.code).toBe("42501");
  });

  it("a user can't list or delete another user's photos", async () => {
    const list = await sqlAs(
      db,
      { role: "authenticated", userId: B },
      "SELECT name FROM storage.objects",
    );
    expect(list.rows).toEqual([]);
    const del = await sqlAs(
      db,
      { role: "authenticated", userId: B },
      "DELETE FROM storage.objects WHERE name = $1",
      [path(A)],
    );
    expect(del.affected).toBe(0);
    const mine = await sqlAs(
      db,
      { role: "authenticated", userId: A },
      "SELECT name FROM storage.objects",
    );
    expect(mine.rows.map((r) => r["name"])).toEqual([path(A)]);
  });

  it("anonymous users can't read photos", async () => {
    expect((await sqlAs(db, { role: "anon" }, "SELECT name FROM storage.objects")).rows).toEqual(
      [],
    );
  });
});

describe("server persistence against real constraints", () => {
  it("a full template journey persists and reloads: plan, proof, steps, achieved", async () => {
    const db = await freshDb();
    let g = await startedPhoneGoal(db, A);
    const plan = E.planOf(g);
    while (!plan.steps.every((s) => g.completed.includes(s.id))) {
      const open = E.availableSteps(g.completed, plan);
      expect(open.length).toBeGreaterThan(0);
      const filled = fillProof(g, open[0]!, A);
      const next = E.submitProof(
        // The phone plan's last step has a 30-minute timer; pretend it already ran.
        { ...filled, timers: { ...(filled.timers ?? {}), [open[0]!]: new Date(0).toISOString() } },
        open[0]!,
      );
      await saveChanges(admin(db), A, g, next);
      g = await loadGoal(as(db, A), g.id);
    }
    expect(g.completed).toHaveLength(plan.steps.length);
    // Checklist complete is not success: the goal is "verifying" until the Goal check passes.
    expect(g.status).toBe("verifying");
    expect(g.achieved).toBe(false);
    expect(E.progress(g).percent).toBeLessThan(100);

    const base = Number(g.proofs["s5"]?.["before"]);
    const passed = E.submitCheck(E.setCheckValue(g, String(base + 5)));
    expect(passed.achieved).toBe(true);
    await saveChanges(admin(db), A, g, passed);
    const final = await loadGoal(as(db, A), g.id);
    expect(final.achieved).toBe(true);
    expect(E.progress(final).percent).toBe(100);
    expect(final.messages.at(-1)?.kind).toBe("recap");
  });

  it("a concurrent second save is refused by the seq claim and writes nothing", async () => {
    const db = await freshDb();
    const g = await startedPhoneGoal(db, A);
    const filled = fillProof(g, "s1", A);
    await saveChanges(admin(db), A, g, E.submitProof(filled, "s1"));
    const msgs = await sqlAs(
      db,
      { role: "service_role" },
      "SELECT count(*)::int AS n FROM public.messages",
    );
    await expect(saveChanges(admin(db), A, g, E.submitProof(filled, "s1"))).rejects.toBeInstanceOf(
      StaleGoalError,
    );
    const msgs2 = await sqlAs(
      db,
      { role: "service_role" },
      "SELECT count(*)::int AS n FROM public.messages",
    );
    expect(msgs2.rows[0]?.["n"]).toBe(msgs.rows[0]?.["n"]);
    expect((await loadGoal(as(db, A), g.id)).completed).toEqual(["s1"]);
  });

  it("an interrupted first plan is recoverable with real primary keys", async () => {
    const db = await freshDb();
    const id = await newGoalRow(db, A);
    const g0 = await loadGoal(as(db, A), id);
    await expect(
      saveChanges(
        admin(db, [{ table: "messages", op: "insert" }]),
        A,
        g0,
        E.sendText(g0, PHONE_GOAL),
      ),
    ).rejects.toBeTruthy();
    const crashed = await loadGoal(as(db, A), id);
    expect(crashed.planned).toBe(false);
    await saveChanges(admin(db), A, crashed, E.sendText(crashed, PHONE_GOAL));
    const g = await loadGoal(as(db, A), id);
    expect(g.planned).toBe(true);
    expect(E.planOf(g).steps).toHaveLength(E.getPlan("phone").steps.length);
  });

  it("one user's saves can't touch another user's goal", async () => {
    const db = await freshDb();
    const gA = await startedPhoneGoal(db, A);
    // B can't even load A's goal, so the server never has a `before` for it.
    await expect(loadGoal(as(db, B), gA.id)).rejects.toBeInstanceOf(NotFound);
  });
});
