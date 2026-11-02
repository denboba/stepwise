// @vitest-environment node
// Spec R8, layer 2: runs only against a disposable LOCAL Supabase stack (CI job "Local Supabase
// integration"), using the real Auth, PostgREST and Storage APIs. It refuses any non-local URL so it can
// never touch production. Locally: `supabase start`, apply drizzle/migrations, then set the SB_TEST_* vars.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import * as E from "@/lib/engine";
import type { Goal } from "@/lib/engine";
import type { Database } from "@/integrations/supabase/types";
import { NotFound, StaleGoalError, loadGoal, saveChanges } from "@/lib/goals.server";

const URL_ = process.env["SB_TEST_URL"] ?? "";
const ANON = process.env["SB_TEST_ANON_KEY"] ?? "";
const SERVICE = process.env["SB_TEST_SERVICE_KEY"] ?? "";
const enabled = !!(URL_ && ANON && SERVICE);
// CI sets SB_TEST_REQUIRED so a missing stack fails loudly instead of skipping to a false green.
if (process.env["SB_TEST_REQUIRED"] && !enabled)
  throw new Error("SB_TEST_REQUIRED is set but the local Supabase variables are missing.");
if (enabled && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_))
  throw new Error("Refusing to run integration tests against a non-local Supabase URL.");

type Db = SupabaseClient<Database>;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const PHONE_GOAL = "my phone won't charge";
const BUCKET = "proof-photos";

async function signedInUser(admin: Db, email: string) {
  const password = `pw-${crypto.randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient<Database>(URL_, ANON, opts);
  const s = await client.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw s.error ?? new Error("no session");
  return { id: created.data.user!.id, client, token: s.data.session.access_token };
}

function fillProof(g: Goal, stepId: string, userId: string): Goal {
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
            ? String(it.min ?? 1)
            : it.kind === "photo"
              ? `${userId}/${g.id}/${stepId}.jpg`
              : "ok",
    );
  return out;
}

describe.skipIf(!enabled)("local Supabase: auth, RLS, storage and persistence", () => {
  let admin: Db;
  let a: Awaited<ReturnType<typeof signedInUser>>;
  let b: Awaited<ReturnType<typeof signedInUser>>;
  let goal: Goal;

  beforeAll(async () => {
    admin = createClient<Database>(URL_, SERVICE, opts);
    const run = crypto.randomUUID().slice(0, 8);
    a = await signedInUser(admin, `a-${run}@example.test`);
    b = await signedInUser(admin, `b-${run}@example.test`);
    const ins = await admin.from("goals").insert({ user_id: a.id }).select("id").single();
    if (ins.error) throw ins.error;
    const g0 = await loadGoal(a.client, ins.data.id);
    await saveChanges(admin, a.id, g0, E.startGoal(E.sendText(g0, PHONE_GOAL)));
    goal = await loadGoal(a.client, ins.data.id);
  }, 60_000);

  it("auth: a real access token yields its user id; a forged token is rejected", async () => {
    // Same check as requireSupabaseAuth (src/integrations/supabase/auth-middleware.ts).
    const verifier = createClient<Database>(URL_, ANON, opts);
    const ok = await verifier.auth.getClaims(a.token);
    expect(ok.error).toBeNull();
    expect(ok.data?.claims.sub).toBe(a.id);
    const [h, p] = a.token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), sub: b.id }),
    ).toString("base64url");
    const forged = await verifier.auth.getClaims(`${h}.${forgedPayload}.invalidsignature`);
    expect(forged.data?.claims ?? null).toBeNull();
  });

  it("RLS: the owner reads the goal; another user gets NotFound", async () => {
    expect((await loadGoal(a.client, goal.id)).started).toBe(true);
    await expect(loadGoal(b.client, goal.id)).rejects.toBeInstanceOf(NotFound);
  });

  it("RLS: signed-in users can't write completion state through the API", async () => {
    const up = await a.client
      .from("goals")
      .update({ achieved: true })
      .eq("id", goal.id)
      .select("id");
    expect(up.data ?? []).toEqual([]);
    const step = await a.client
      .from("goal_steps")
      .update({ done: true })
      .eq("goal_id", goal.id)
      .select("step_key");
    expect(step.data ?? []).toEqual([]);
    const proof = await a.client.from("proof_submissions").insert({
      goal_id: goal.id,
      user_id: a.id,
      step_key: "s1",
      item_key: "off",
      value: true,
    });
    expect(proof.error).not.toBeNull();
    const fresh = await loadGoal(a.client, goal.id);
    expect(fresh.achieved).toBe(false);
    expect(fresh.completed).toEqual([]);
  });

  it("RLS: another user can't delete the goal", async () => {
    await b.client.from("goals").delete().eq("id", goal.id);
    expect((await admin.from("goals").select("id").eq("id", goal.id)).data).toHaveLength(1);
  });

  it("storage: uploads only into your own folder; others can't read or delete", async () => {
    const path = `${a.id}/${goal.id}/s4-photo.jpg`;
    const bytes = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
    expect((await a.client.storage.from(BUCKET).upload(path, bytes)).error).toBeNull();
    expect(
      (await b.client.storage.from(BUCKET).upload(`${a.id}/${goal.id}/intruder.jpg`, bytes)).error,
    ).not.toBeNull();
    expect((await b.client.storage.from(BUCKET).download(path)).error).not.toBeNull();
    await b.client.storage.from(BUCKET).remove([path]);
    expect((await a.client.storage.from(BUCKET).download(path)).error).toBeNull();
    // The server's photo check reads with the service role.
    expect((await admin.storage.from(BUCKET).download(path)).error).toBeNull();
  });

  it("concurrency: two simultaneous saves of the same step, exactly one wins", async () => {
    const before = await loadGoal(a.client, goal.id);
    const next = E.submitProof(fillProof(before, "s1", a.id), "s1");
    const results = await Promise.allSettled([
      saveChanges(admin, a.id, before, next),
      saveChanges(admin, a.id, before, next),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(StaleGoalError);
    const after = await loadGoal(a.client, goal.id);
    expect(after.completed).toEqual(["s1"]);
    expect(
      after.messages.filter((m) => m.kind === "text" && m.text === "Step 1 verified."),
    ).toHaveLength(1);
  });
});
