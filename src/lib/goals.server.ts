import type { CaseData } from "./casefw";
import { currentStatus, isGoalStatus, nextStatus, type LifecycleEvent } from "./lifecycle";
import { parseEvents } from "./activity";
// Server-only helpers: turn database rows into an engine Goal and save engine changes back.
// All rule decisions come from the pure engine in ./engine.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Goal, IntakeAnswer, Msg, PatchInfo, PhotoVerdict, ProofValue } from "./engine";
import {
  PLANS,
  type GoalCheck,
  type Plan,
  type ProofItem,
  type ProofKind,
  type Step,
} from "./plan";

type Db = SupabaseClient<Database>;

export class NotFound extends Error {}

/** Loads one goal. `userDb` runs as the signed-in user (RLS), so another user's goal is simply not found. */
export async function loadGoal(userDb: Db, goalId: string): Promise<Goal> {
  const { data: g, error } = await userDb.from("goals").select("*").eq("id", goalId).maybeSingle();
  if (error) throw error;
  if (!g) throw new NotFound("Goal not found");

  const [steps, prereqs, items, subs, msgs, customPlan, checks, overrides, patches, revisions] =
    await Promise.all([
      userDb.from("goal_steps").select("*").eq("goal_id", goalId).order("position"),
      userDb.from("step_prereqs").select("*").eq("goal_id", goalId),
      userDb.from("proof_items").select("*").eq("goal_id", goalId).order("position"),
      userDb.from("proof_submissions").select("*").eq("goal_id", goalId),
      userDb.from("messages").select("*").eq("goal_id", goalId).order("seq"),
      g.custom
        ? userDb.from("custom_plans").select("data").eq("goal_id", goalId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      userDb
        .from("photo_checks")
        .select("step_key,verdict,created_at")
        .eq("goal_id", goalId)
        .order("created_at"),
      userDb.from("proof_overrides").select("step_key,reason").eq("goal_id", goalId),
      userDb.from("plan_patches").select("id,status,summary,patch").eq("goal_id", goalId),
      userDb
        .from("plan_revisions")
        .select("id", { count: "exact", head: true })
        .eq("goal_id", goalId)
        .eq("restored", false),
    ]);
  for (const r of [
    steps,
    prereqs,
    items,
    subs,
    msgs,
    customPlan,
    checks,
    overrides,
    patches,
    revisions,
  ])
    if (r.error) throw r.error;

  const goal: Goal = {
    id: g.id,
    planned: g.planned,
    started: g.started,
    achieved: g.achieved,
    seq: g.seq,
    completed: [],
    ack: {},
    proofs: {},
    checkValue: "",
    checkProofs: {},
    messages: (msgs.data ?? []).map((m) => toMsg(g.id, m)),
    paused: g.paused,
    replanCount: g.replan_count,
    revisions: revisions.count ?? 0,
    patches: {},
    stuckCounts: {},
  };
  for (const pt of patches.data ?? []) {
    goal.patches![pt.id] = {
      status: pt.status as PatchInfo["status"],
      summary: pt.summary as unknown as PatchInfo["summary"],
      reason: String((pt.patch as { reason?: unknown } | null)?.reason ?? ""),
    };
  }
  for (const s of steps.data ?? [])
    if (s.stuck_count) goal.stuckCounts![s.step_key] = s.stuck_count;
  // Lifecycle columns exist only after the ADR-0001 migration; until then statuses are derived only.
  const raw = g as Record<string, unknown>;
  if ("status" in raw) {
    goal.lifecyclePersisted = true;
    if (isGoalStatus(raw["status"])) goal.status = raw["status"];
    goal.statusReason = typeof raw["status_reason"] === "string" ? raw["status_reason"] : null;
  }
  if (g.custom) {
    goal.custom = true;
    goal.intake = (g.intake as unknown as IntakeAnswer[]) ?? [];
  }
  if (g.template_id) goal.planId = g.template_id;
  if (g.case_data) goal.caseData = g.case_data as unknown as CaseData;

  if (g.planned) {
    if (g.custom && customPlan.data) {
      goal.planId = `custom:${g.id}`;
      goal.plan = customPlan.data.data as unknown as Plan;
    } else {
      const planSteps: Step[] = (steps.data ?? []).map((s) => {
        const step: Step = {
          id: s.step_key,
          title: s.title,
          minutes: s.minutes,
          prereqs: (prereqs.data ?? [])
            .filter((p) => p.step_key === s.step_key)
            .map((p) => p.prereq_key),
          actions: (s.actions as string[]) ?? [],
          proof: (items.data ?? [])
            .filter((i) => i.step_key === s.step_key)
            .map((i) => {
              const it: ProofItem = { id: i.item_key, label: i.label, kind: i.kind as ProofKind };
              if (i.min_value !== null) it.min = Number(i.min_value);
              if (i.max_value !== null) it.max = Number(i.max_value);
              return it;
            }),
          hint: s.hint,
          why: s.why,
        };
        if (s.safety) step.safety = s.safety;
        if (s.recap) step.recap = s.recap;
        if (s.wait_seconds !== null) step.waitSeconds = s.wait_seconds;
        return step;
      });
      goal.plan = {
        id: g.template_id ?? "",
        title: g.title ?? "",
        goal: g.goal_text ?? "",
        doneMeans: g.done_means ?? "",
        keywords: [],
        steps: planSteps,
        check: g.check_def as unknown as GoalCheck,
      };
    }
    const doneSteps = (steps.data ?? [])
      .filter((s) => s.done)
      .sort((a, b) => String(a.done_at).localeCompare(String(b.done_at)));
    goal.completed = doneSteps.map((s) => s.step_key);
    for (const s of steps.data ?? []) if (s.acknowledged) goal.ack[s.step_key] = true;
    goal.timers = {};
    goal.timerPosted = {};
    for (const s of steps.data ?? []) {
      if (s.timer_started_at) goal.timers[s.step_key] = s.timer_started_at;
      if (s.timer_done_posted) goal.timerPosted[s.step_key] = true;
    }
    goal.verdicts = {};
    goal.unclearStreak = {};
    for (const c of checks.data ?? []) {
      goal.verdicts[c.step_key] = c.verdict as PhotoVerdict;
      goal.unclearStreak[c.step_key] =
        c.verdict === "unclear" ? (goal.unclearStreak[c.step_key] ?? 0) + 1 : 0;
    }
    goal.overrideOffered = {};
    for (const s of steps.data ?? [])
      if (s.override_offered) goal.overrideOffered[s.step_key] = true;
    goal.overrides = {};
    for (const o of overrides.data ?? []) goal.overrides[o.step_key] = o.reason;
    for (const p of subs.data ?? []) {
      (goal.proofs[p.step_key] ??= {})[p.item_key] = p.value as ProofValue;
    }
  }
  // Sticky statuses come from the database; everything else is re-derived from the state just loaded.
  goal.status = currentStatus(goal, Date.now());
  return goal;
}

function toMsg(goalId: string, m: Database["public"]["Tables"]["messages"]["Row"]): Msg {
  const id = `${goalId}-${m.seq}`;
  const role = m.role as "user" | "assistant";
  switch (m.kind) {
    case "text":
      return { id, role, kind: "text", text: m.body ?? "" } as Msg;
    case "tasks":
      return { id, role: "assistant", kind: "tasks", stepIds: (m.step_ids as string[]) ?? [] };
    case "intake":
      return {
        id,
        role: "assistant",
        kind: "intake",
        question: m.body ?? "",
        options: (m.step_ids as string[]) ?? [],
      };
    case "replanAsk":
      return {
        id,
        role: "assistant",
        kind: "replanAsk",
        question: m.body ?? "",
        options: (m.step_ids as string[]) ?? [],
      };
    case "aiError":
      return { id, role: "assistant", kind: "aiError", retry: m.body ?? "{}" };
    case "patch":
      return { id, role: "assistant", kind: "patch", patchId: m.body ?? "" };
    case "activity":
      return { id, role: "assistant", kind: "activity", events: parseEvents(m.body) };
    case "setup":
    case "approach":
    case "escalation":
      return { id, role: "assistant", kind: m.kind };
    default:
      return {
        id,
        role: "assistant",
        kind: m.kind as "goal" | "check" | "checkFail" | "recap" | "replanLimit",
      };
  }
}

function stepRows(userId: string, goalId: string, s: Step, position: number) {
  return {
    step: {
      goal_id: goalId,
      user_id: userId,
      step_key: s.id,
      position,
      title: s.title,
      minutes: s.minutes,
      safety: s.safety ?? null,
      actions: s.actions as unknown as Json,
      hint: s.hint,
      why: s.why,
      recap: s.recap ?? null,
      wait_seconds: s.waitSeconds ?? null,
    },
    prereqs: s.prereqs.map((r) => ({
      goal_id: goalId,
      user_id: userId,
      step_key: s.id,
      prereq_key: r,
    })),
    items: s.proof.map((it, i) => ({
      goal_id: goalId,
      user_id: userId,
      step_key: s.id,
      item_key: it.id,
      position: i,
      label: it.label,
      kind: it.kind,
      min_value: it.min ?? null,
      max_value: it.max ?? null,
    })),
  };
}

/**
 * Writes an updated plan into the goal's own rows. Only steps that are new, changed or removed are touched,
 * so done steps (which validation never lets a patch change) keep their rows, proof and timestamps.
 */
export async function writePlan(admin: Db, userId: string, goal: Goal, current: Plan, next: Plan) {
  const cur = new Map(current.steps.map((s) => [s.id, JSON.stringify(s)]));
  const nextIds = new Set(next.steps.map((s) => s.id));
  const changed = next.steps
    .filter((s) => cur.has(s.id) && cur.get(s.id) !== JSON.stringify(s))
    .map((s) => s.id);
  const removed = current.steps.filter((s) => !nextIds.has(s.id)).map((s) => s.id);
  const drop = [...changed, ...removed].filter((id) => !goal.completed.includes(id));
  if (drop.length) {
    for (const table of ["proof_items", "step_prereqs", "goal_steps"] as const) {
      const r = await admin.from(table).delete().eq("goal_id", goal.id).in("step_key", drop);
      if (r.error) throw r.error;
    }
  }
  const fresh = next.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !cur.has(s.id) || changed.includes(s.id));
  const rows = fresh.map(({ s, i }) => stepRows(userId, goal.id, s, i));
  if (rows.length) {
    const r1 = await admin.from("goal_steps").insert(rows.map((r) => r.step));
    if (r1.error) throw r1.error;
    const pre = rows.flatMap((r) => r.prereqs);
    if (pre.length) {
      const r2 = await admin.from("step_prereqs").insert(pre);
      if (r2.error) throw r2.error;
    }
    const r3 = await admin.from("proof_items").insert(rows.flatMap((r) => r.items));
    if (r3.error) throw r3.error;
  }
  for (const [i, s] of next.steps.entries()) {
    if (fresh.some((f) => f.s.id === s.id)) continue;
    const r = await admin
      .from("goal_steps")
      .update({ position: i })
      .eq("goal_id", goal.id)
      .eq("step_key", s.id);
    if (r.error) throw r.error;
  }
  if (goal.custom) {
    const rc = await admin
      .from("custom_plans")
      .update({ data: next as unknown as Json })
      .eq("goal_id", goal.id);
    if (rc.error) throw rc.error;
  }
}

/**
 * Copies a template into the goal's own step, prerequisite and proof-item rows. Only called for a goal
 * that wasn't planned yet, which can't have legitimate plan rows, so rows left by an interrupted earlier
 * attempt are cleared first and a retry succeeds instead of hitting a primary-key conflict forever.
 * Proof submissions are never deleted here.
 */
async function copyPlan(admin: Db, userId: string, goalId: string, plan: Plan) {
  for (const table of ["proof_items", "step_prereqs", "goal_steps", "custom_plans"] as const) {
    const r = await admin.from(table).delete().eq("goal_id", goalId);
    if (r.error) throw r.error;
  }
  const custom = plan.id.startsWith("custom:");
  const steps = plan.steps.map((s, i) => ({
    goal_id: goalId,
    user_id: userId,
    step_key: s.id,
    position: i,
    title: s.title,
    minutes: s.minutes,
    safety: s.safety ?? null,
    actions: s.actions as unknown as Json,
    hint: s.hint,
    why: s.why,
    recap: s.recap ?? null,
    wait_seconds: s.waitSeconds ?? null,
  }));
  const prereqs = plan.steps.flatMap((s) =>
    s.prereqs.map((r) => ({ goal_id: goalId, user_id: userId, step_key: s.id, prereq_key: r })),
  );
  const items = plan.steps.flatMap((s) =>
    s.proof.map((it, i) => ({
      goal_id: goalId,
      user_id: userId,
      step_key: s.id,
      item_key: it.id,
      position: i,
      label: it.label,
      kind: it.kind,
      min_value: it.min ?? null,
      max_value: it.max ?? null,
    })),
  );
  const r1 = await admin.from("goal_steps").insert(steps);
  if (r1.error) throw r1.error;
  if (prereqs.length) {
    const r2 = await admin.from("step_prereqs").insert(prereqs);
    if (r2.error) throw r2.error;
  }
  const r3 = await admin.from("proof_items").insert(items);
  if (r3.error) throw r3.error;
  if (custom) {
    const rc = await admin
      .from("custom_plans")
      .insert({ goal_id: goalId, user_id: userId, data: plan as unknown as Json });
    if (rc.error) throw rc.error;
  }
  const r4 = await admin
    .from("goals")
    .update({
      template_id: custom ? null : plan.id,
      title: plan.title,
      goal_text: plan.goal,
      done_means: plan.doneMeans,
      check_def: plan.check as unknown as Json,
    })
    .eq("id", goalId);
  if (r4.error) throw r4.error;
}

/** Another request changed the goal after `before` was loaded; nothing was written. */
export class StaleGoalError extends Error {
  constructor() {
    super("Goal changed since it was loaded");
  }
}

/**
 * Saves the difference between two engine states. Only the server calls this.
 *
 * First it claims the change with a compare-and-set on `goals.seq`: if another request (double tap,
 * second device) already moved the goal on, zero rows match, nothing else is written and StaleGoalError
 * is thrown. The claim only advances `seq`, so a failure later in this function leaves at most a gap in
 * message numbers, never a goal that can't be saved again.
 */
export async function saveChanges(admin: Db, userId: string, before: Goal, after: Goal) {
  const claim = await admin
    .from("goals")
    .update({ seq: after.seq, updated_at: new Date().toISOString() })
    .eq("id", after.id)
    .eq("seq", before.seq)
    .select("id");
  if (claim.error) throw claim.error;
  if (!claim.data?.length) throw new StaleGoalError();

  if (!before.planned && after.planned && after.plan) {
    await copyPlan(admin, userId, after.id, after.plan);
  }

  for (const stepId of after.completed.filter((s) => !before.completed.includes(s))) {
    const vals = after.proofs[stepId] ?? {};
    const rows = Object.entries(vals).map(([item_key, value]) => ({
      goal_id: after.id,
      user_id: userId,
      step_key: stepId,
      item_key,
      value: value as Json,
    }));
    if (rows.length) {
      const r = await admin.from("proof_submissions").upsert(rows);
      if (r.error) throw r.error;
    }
    const r = await admin
      .from("goal_steps")
      .update({ done: true, done_at: new Date().toISOString(), acknowledged: !!after.ack[stepId] })
      .eq("goal_id", after.id)
      .eq("step_key", stepId);
    if (r.error) throw r.error;
  }

  const newMsgs = after.messages.slice(before.messages.length).map((m) => {
    const seq = Number(m.id.split("-").pop());
    return {
      goal_id: after.id,
      user_id: userId,
      seq,
      role: m.role,
      kind: m.kind,
      body:
        m.kind === "text"
          ? m.text
          : m.kind === "intake" || m.kind === "replanAsk"
            ? m.question
            : m.kind === "patch"
              ? m.patchId
              : m.kind === "aiError"
                ? m.retry
                : m.kind === "activity"
                  ? JSON.stringify(m.events)
                  : null,
      step_ids:
        m.kind === "tasks"
          ? (m.stepIds as unknown as Json)
          : m.kind === "intake" || m.kind === "replanAsk"
            ? (m.options as unknown as Json)
            : null,
    };
  });
  if (newMsgs.length) {
    const r = await admin.from("messages").insert(newMsgs);
    if (r.error) throw r.error;
  }

  const intakeChanged = JSON.stringify(before.intake ?? []) !== JSON.stringify(after.intake ?? []);
  const r = await admin
    .from("goals")
    .update({
      planned: after.planned,
      started: after.started,
      achieved: after.achieved,
      seq: after.seq,
      paused: !!after.paused,
      updated_at: new Date().toISOString(),
      ...(after.custom && !before.custom ? { custom: true } : {}),
      ...(intakeChanged ? { intake: (after.intake ?? []) as unknown as Json } : {}),
      ...(JSON.stringify(before.caseData ?? null) !== JSON.stringify(after.caseData ?? null)
        ? { case_data: (after.caseData ?? null) as unknown as Json }
        : {}),
      ...lifecycleColumns(before, after),
    })
    .eq("id", after.id);
  if (r.error) throw r.error;
}

/**
 * Status columns to write, only when the ADR-0001 columns exist. They aren't in the generated types until
 * Lovable applies the migration and regenerates `types.ts`, hence the narrow cast.
 */
function lifecycleColumns(before: Goal, after: Goal): Record<string, never> {
  if (!after.lifecyclePersisted || !after.status) return {};
  const changed = before.status !== after.status;
  return {
    status: after.status,
    status_reason: after.statusReason ?? null,
    ...(changed ? { status_changed_at: new Date().toISOString() } : {}),
  } as unknown as Record<string, never>;
}

export type SaveResult = { ok: true } | { ok: false; reason: string };

/**
 * Decides the lifecycle status for `after` (deterministic, see lifecycle.ts) and saves. An impossible
 * status move saves nothing. Sticky events (end, escalate) need the lifecycle columns; without them the
 * caller gets a clear refusal instead of a silent, unsaved status.
 */
export async function saveWithLifecycle(
  admin: Db,
  userId: string,
  before: Goal,
  after: Goal,
  event?: LifecycleEvent,
  now = Date.now(),
): Promise<SaveResult> {
  if (event && event.type !== "resolveEscalation" && !before.lifecyclePersisted)
    return { ok: false, reason: LIFECYCLE_NOT_READY };
  const next = nextStatus(before, after, now, event);
  if (!next.ok) return { ok: false, reason: next.error };
  await saveChanges(admin, userId, before, {
    ...after,
    status: next.status,
    statusReason: next.reason,
    lifecyclePersisted: !!before.lifecyclePersisted,
  });
  return { ok: true };
}

export const LIFECYCLE_NOT_READY =
  "Ending or escalating goals needs a database update that hasn't been applied yet.";

// Template content is defined in src/lib/plan.ts; plan_templates rows only anchor goal.template_id.
export async function loadTemplates(_userDb: Db): Promise<Plan[]> {
  return PLANS;
}
