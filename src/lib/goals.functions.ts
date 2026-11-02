// Authenticated server-function boundary. Each function authenticates the request (requireSupabaseAuth),
// validates input, and hands off to the handlers in actions.server.ts with the RLS client and the verified
// user id. Business logic lives in actions.server.ts, engine.ts and lifecycle.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import * as E from "./engine";
import { loadGoal } from "./goals.server";
import * as L from "./lifecycle";
import {
  PHOTO_BUCKET,
  actionSchema,
  checkInput,
  proofInput,
  realAi,
  runGoalAction,
  runSubmitGoalCheck,
  runSubmitProof,
  type ActionResult,
  type Deps,
} from "./actions.server";

export type { ActionResult } from "./actions.server";
export { PHOTO_BUCKET, STALE_NOTICE } from "./actions.server";

/** Production dependencies: the user's RLS client and the user id from the verified token. */
async function deps(context: {
  supabase: Parameters<typeof loadGoal>[0];
  userId: string;
}): Promise<Deps> {
  return {
    userDb: context.supabase,
    admin: await admin(),
    userId: context.userId,
    ai: realAi,
    now: () => Date.now(),
  };
}

const goalId = z.string().uuid();

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const listGoals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const [goals, steps] = await Promise.all([
      // "*" so the lifecycle `status` column is read when it exists (ADR-0001) without failing before.
      db.from("goals").select("*").order("created_at", { ascending: false }),
      db.from("goal_steps").select("goal_id,done"),
    ]);
    if (goals.error) throw goals.error;
    if (steps.error) throw steps.error;
    return (goals.data ?? []).map((g) => {
      const mine = (steps.data ?? []).filter((s) => s.goal_id === g.id);
      // 100% only once the Goal check has passed; status is shown as text in the goal list.
      const summary = E.goalSummary({
        planned: g.planned,
        started: g.started,
        paused: g.paused,
        achieved: g.achieved,
        done: mine.filter((s) => s.done).length,
        total: mine.length,
        hasInput: g.seq > 0,
      });
      // Stored lifecycle status when the column exists; otherwise the coarse status from flags.
      const stored = (g as Record<string, unknown>)["status"];
      const status: L.GoalStatus = L.isGoalStatus(stored) ? stored : summary.status;
      return {
        id: g.id,
        title: g.planned ? (g.title ?? "Goal") : "New goal",
        percent: summary.percent,
        status,
      };
    });
  });

export const getGoal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ goalId }).parse(d))
  .handler(async ({ data, context }) => loadGoal(context.supabase, data.goalId));

/** Returns the user's empty draft goal, or creates one. */
export const createGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: blank } = await context.supabase
      .from("goals")
      .select("id")
      .eq("planned", false)
      .eq("seq", 0)
      .limit(1)
      .maybeSingle();
    if (blank) return loadGoal(context.supabase, blank.id);
    const db = await admin();
    const { data, error } = await db
      .from("goals")
      .insert({ user_id: context.userId })
      .select("id")
      .single();
    if (error) throw error;
    return loadGoal(context.supabase, data.id);
  });

/** Chat actions that never mark anything done: typing, picking a goal, Start, I'm stuck, Retry check. */
export const goalAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => actionSchema.parse(d))
  .handler(async ({ data, context }): Promise<ActionResult> =>
    runGoalAction(await deps(context), data),
  );

/** The only way a step becomes done. */
export const submitProof = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => proofInput.parse(d))
  .handler(async ({ data, context }): Promise<ActionResult> =>
    runSubmitProof(await deps(context), data),
  );

/** The only way a goal becomes achieved. */
export const submitGoalCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => checkInput.parse(d))
  .handler(async ({ data, context }): Promise<ActionResult> =>
    runSubmitGoalCheck(await deps(context), data),
  );

export const deleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ goalId }).parse(d))
  .handler(async ({ data, context }) => {
    // Remove this goal's proof photos first (the user's own folder only).
    const folder = `${context.userId}/${data.goalId}`;
    const listed = await context.supabase.storage.from(PHOTO_BUCKET).list(folder, { limit: 1000 });
    if (listed.error) throw listed.error;
    if (listed.data?.length) {
      const rm = await context.supabase.storage
        .from(PHOTO_BUCKET)
        .remove(listed.data.map((f) => `${folder}/${f.name}`));
      if (rm.error) throw rm.error;
    }
    // Runs as the user: row security only lets them delete their own goal; everything attached is removed with it.
    const { error, count } = await context.supabase
      .from("goals")
      .delete({ count: "exact" })
      .eq("id", data.goalId);
    if (error) throw error;
    return { deleted: (count ?? 0) > 0 };
  });
