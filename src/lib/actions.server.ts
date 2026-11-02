// Server-only action handlers behind the authenticated server functions in goals.functions.ts.
// Moved here from goals.functions.ts with behavior unchanged; the database clients, the AI and the clock
// are now parameters (`Deps`), so whole journeys can run in tests against a real database with a
// scripted AI (spec R9). Authorization stays at the boundary: `userDb` is the signed-in user's RLS client
// and `userId` comes from the verified access token. Nothing here trusts a client-supplied user id.
import { z } from "zod";
import * as E from "./engine";
import type { Goal } from "./engine";
import type { Plan } from "./plan";
import {
  StaleGoalError,
  loadGoal,
  loadTemplates,
  saveWithLifecycle,
  writePlan,
} from "./goals.server";
import * as L from "./lifecycle";
import type { LifecycleEvent } from "./lifecycle";
import {
  AiCallError,
  RateLimitError,
  aiHint,
  aiIntake,
  aiPhotoCheck,
  aiPlan,
  aiReplan,
  aiSideQuestion,
} from "./ai.server";
import type { Json } from "@/integrations/supabase/types";
import { LABELS, recorder, withActivity, type Recorder, type ActivityEvent } from "./activity";
import { gateText } from "./safety";
import { MAX_PHOTOS_PER_STEP, MAX_PHOTO_BYTES } from "./limits";

export const PHOTO_BUCKET = "proof-photos";
const MAX_INTAKE_QUESTIONS = 3;
const goalId = z.string().uuid();

type Db = Parameters<typeof loadGoal>[0];

/** The AI calls a handler may make. Production uses ai.server.ts; tests pass a scripted double. */
export interface AiPort {
  aiIntake: typeof aiIntake;
  aiPlan: typeof aiPlan;
  aiReplan: typeof aiReplan;
  aiSideQuestion: typeof aiSideQuestion;
  aiHint: typeof aiHint;
  aiPhotoCheck: typeof aiPhotoCheck;
}
export const realAi: AiPort = { aiIntake, aiPlan, aiReplan, aiSideQuestion, aiHint, aiPhotoCheck };

export interface Deps {
  /** The signed-in user's client: row-level security applies to every read. */
  userDb: Db;
  /** Service-role client; every write is scoped to a goal first loaded through `userDb`. */
  admin: Db;
  /** From the verified access token. */
  userId: string;
  ai: AiPort;
  now: () => number;
}
type Ctx = Deps & { rec?: Recorder };
type Fail = { ok: false; reason: string };

/** `notice` is set when the request lost a race and the latest saved goal is returned instead. */
export type ActionResult =
  { ok: true; goal: Goal; notice?: string } | { ok: false; reason: string };

export const STALE_NOTICE = "This goal changed in another window. Showing the latest.";

/** Saves `after` and returns the reloaded goal; a lost compare-and-set returns the latest goal and a notice. */
export async function commit(
  deps: Deps,
  before: Goal,
  after: Goal,
  event?: LifecycleEvent,
): Promise<ActionResult> {
  try {
    // The lifecycle status is decided in code here (lifecycle.ts); an impossible move saves nothing.
    const saved = await saveWithLifecycle(
      deps.admin,
      deps.userId,
      before,
      after,
      event,
      deps.now(),
    );
    if (!saved.ok) return saved;
  } catch (e) {
    if (!(e instanceof StaleGoalError)) throw e;
    return { ok: true, goal: await loadGoal(deps.userDb, before.id), notice: STALE_NOTICE };
  }
  return { ok: true, goal: await loadGoal(deps.userDb, before.id) };
}

const SKIP_WORDS = /^(done|next|skip)\b/i;

/**
 * Custom-goal flow for text that matches no built-in template:
 * intake questions (max 3, one at a time), then AI plan generation with
 * validation and one retry. The AI never marks anything done.
 */
async function customIntake(before: Goal, text: string, deps: Deps, rec?: Recorder): Promise<Goal> {
  const step = <T>(ph: Parameters<Recorder["step"]>[0], l: string, fn: () => Promise<T>) =>
    rec ? rec.step(ph, l, fn) : fn();
  // The first user message is the goal; later texts answer the pending question or add detail (pure, tested).
  const { goalText, intake } = E.intakeTurn(before, text);
  const g: Goal = { ...E.userText({ ...before, custom: true }, text), intake };

  if (intake.length < MAX_INTAKE_QUESTIONS) {
    const res = await step("understand", LABELS.understand, () =>
      deps.ai.aiIntake(deps.userId, g.id, goalText, intake),
    );
    if ("question" in res) return E.askIntake(g, res.question, res.options);
  }

  // Enough context: build the plan. Validate in code; on failure retry once with the error list.
  const raw = await step("plan", LABELS.plan, () =>
    deps.ai.aiPlan(deps.userId, g.id, goalText, intake),
  );
  let errors = E.validateAiPlan(raw);
  let planRaw = raw;
  if (errors.length) {
    planRaw = await step("plan", LABELS.validate, () =>
      deps.ai.aiPlan(deps.userId, g.id, goalText, intake, errors),
    );
    errors = E.validateAiPlan(planRaw);
  }
  if (errors.length) return E.planFailed(g);

  const plan = E.aiPlanToPlan(planRaw as E.AiPlan, `custom:${g.id}`);
  return E.planGoal(g, plan.id, plan);
}

/**
 * The user answered the replan question: ask the AI for a patch, validate it in code (one retry with the
 * error list), save it as pending and post the "Plan update" card. Nothing changes until the user taps Apply.
 */
async function proposeReplan(
  before: Goal,
  question: string,
  text: string,
  deps: Deps,
  rec?: Recorder,
): Promise<Goal> {
  const step = <T>(l: string, fn: () => Promise<T>) => (rec ? rec.step("plan", l, fn) : fn());
  const g = E.userText(before, text);
  const plan = E.planOf(g);
  const status = Object.fromEntries(
    plan.steps.map((s) => [s.id, E.stepStatus(s.id, g.completed, plan)]),
  );
  let raw: unknown;
  let errors: string[];
  raw = await step(LABELS.replan, () =>
    deps.ai.aiReplan(deps.userId, g.id, plan, status, question, text),
  );
  errors = E.validatePatch(plan, g.completed, raw);
  if (errors.length) {
    const errs = errors;
    raw = await step(LABELS.validatePatch, () =>
      deps.ai.aiReplan(deps.userId, g.id, plan, status, question, text, errs),
    );
    errors = E.validatePatch(plan, g.completed, raw);
  }
  if (errors.length) {
    console.error("replan invalid", errors);
    return E.replanFailed(g);
  }
  const patch = raw as E.PlanPatch;
  patch.reason = patch.reason.trim();
  const db = deps.admin;
  // Only one update can be pending at a time.
  await db
    .from("plan_patches")
    .update({ status: "kept" })
    .eq("goal_id", g.id)
    .eq("status", "pending");
  const { data, error } = await db
    .from("plan_patches")
    .insert({
      goal_id: g.id,
      user_id: deps.userId,
      patch: patch as unknown as Json,
      summary: E.patchSummary(plan, patch) as unknown as Json,
    })
    .select("id")
    .single();
  if (error) throw error;
  return E.proposePatch(g, data.id);
}

export const actionSchema = z.object({
  goalId,
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string().min(1).max(2000) }),
    z.object({ type: z.literal("pick"), planId: z.string().max(50) }),
    z.object({ type: z.literal("start") }),
    z.object({ type: z.literal("stuck"), stepId: z.string().max(50) }),
    z.object({ type: z.literal("retry") }),
    z.object({ type: z.literal("startTimer"), stepId: z.string().max(50) }),
    z.object({ type: z.literal("timerDone"), stepId: z.string().max(50) }),
    z.object({ type: z.literal("applyPatch"), patchId: z.string().uuid() }),
    z.object({ type: z.literal("keepPatch"), patchId: z.string().uuid() }),
    z.object({ type: z.literal("restorePlan") }),
    z.object({ type: z.literal("pause") }),
    z.object({ type: z.literal("resume") }),
    z.object({ type: z.literal("anotherApproach") }),
    z.object({ type: z.literal("retryAi") }),
    z.object({ type: z.literal("end"), reason: z.string().trim().min(3).max(300) }),
    z.object({ type: z.literal("escalate") }),
    z.object({ type: z.literal("resolveEscalation") }),
  ]),
});

export type ActionInput = z.infer<typeof actionSchema>;
type Action = ActionInput["action"];

/** Runs one chat action and returns the next engine state (or a refusal). AI errors are thrown to the caller. */
async function dispatch(before: Goal, a: Action, context: Ctx): Promise<Goal | Fail> {
  let after = before;
  const status = before.status ?? "active";
  if (!L.actionAllowed(status, a.type))
    return {
      ok: false,
      reason: status === "abandoned" ? "This goal has ended." : L.ESCALATED_HOLD_LINE,
    };
  // Lifecycle actions: the status itself is decided in commit() via lifecycle.nextStatus.
  if (a.type === "end") return E.postLine(before, L.ENDED_LINE);
  if (a.type === "escalate") return E.postLine(before, L.ESCALATE_LINE);
  if (a.type === "resolveEscalation") {
    if (status !== "escalated") return { ok: false, reason: "This goal isn't on hold." };
    return E.continueWith(before, L.RESOLVED_LINE);
  }
  // On hold: no guidance until the user confirms it's safe (life-safety text is still gated earlier).
  if (status === "escalated" && a.type === "text")
    return E.postLine(E.userText(before, a.text), L.ESCALATED_HOLD_LINE);
  const PAUSED = { ok: false as const, reason: "Goal is paused. Tap Resume first." };
  if (before.paused && !["text", "resume"].includes(a.type)) return PAUSED;
  if (a.type === "text") {
    const replanQ = E.replanOpen(before) ? E.pendingReplanAsk(before) : null;
    const photoStep =
      E.replanOpen(before) && E.isNoPhotoText(a.text) ? E.openPhotoStep(before) : null;
    if (photoStep) {
      const r = await context.admin
        .from("goal_steps")
        .update({ override_offered: true })
        .eq("goal_id", before.id)
        .eq("step_key", photoStep);
      if (r.error) throw r.error;
      after = E.offerOverride(E.userText(before, a.text), photoStep);
    } else if (replanQ) {
      after = await proposeReplan(before, replanQ, a.text, context, context.rec);
    } else if (E.replanOpen(before) && E.isReplanText(a.text)) {
      after = E.askReplan(E.userText(before, a.text), "text");
    } else if (!before.planned) {
      const templates = await loadTemplates(context.userDb);
      if (E.planForText(a.text, templates)) {
        after = E.sendText(before, a.text, templates);
      } else {
        after = await customIntake(before, a.text, context, context.rec);
      }
    } else if (
      before.custom &&
      before.started &&
      !before.achieved &&
      before.completed.length < E.planOf(before).steps.length &&
      !SKIP_WORDS.test(a.text.trim())
    ) {
      // Side question on a custom goal: the AI answers in at most 2 sentences, then the app re-shows the open task.
      const plan = E.planOf(before);
      const openId = E.availableSteps(before.completed, plan)[0] ?? null;
      const answer = await context.ai.aiSideQuestion(
        context.userId,
        before.id,
        plan,
        openId ? E.getStep(openId, plan) : null,
        a.text,
      );
      after = E.sideAnswer(E.userText(before, a.text), answer);
    } else {
      after = E.sendText(before, a.text);
    }
  } else if (a.type === "pick") {
    if (before.planned) return { ok: false, reason: "This goal already has a plan." };
    const plan = (await loadTemplates(context.userDb)).find((p) => p.id === a.planId);
    if (!plan) return { ok: false, reason: "Unknown goal." };
    after = E.planGoal(before, plan.id, plan);
  } else if (a.type === "start") {
    if (!before.planned) return { ok: false, reason: "Pick a goal first." };
    after = E.startGoal(before);
  } else if (a.type === "stuck") {
    if (
      !before.started ||
      E.stepStatus(a.stepId, before.completed, E.planOf(before)) !== "available"
    )
      return { ok: false, reason: "That step isn't open." };
    const db = context.admin;
    const replan = E.stuckTriggersReplan(before, a.stepId);
    const r = await db
      .from("goal_steps")
      .update({ stuck_count: replan ? 0 : (before.stuckCounts?.[a.stepId] ?? 0) + 1 })
      .eq("goal_id", before.id)
      .eq("step_key", a.stepId);
    if (r.error) throw r.error;
    if (replan) {
      after = E.askReplan(before, "stuck", a.stepId);
    } else if (before.custom) {
      const hint = await context.ai.aiHint(
        context.userId,
        before.id,
        E.planOf(before),
        E.getStep(a.stepId, E.planOf(before)),
      );
      after = E.stuckHint(before, hint);
    } else {
      after = E.stuck(before, a.stepId);
    }
  } else if (a.type === "startTimer" || a.type === "timerDone") {
    const plan = E.planOf(before);
    const step = plan.steps.find((x) => x.id === a.stepId);
    if (
      !before.started ||
      !step?.waitSeconds ||
      E.stepStatus(step.id, before.completed, plan) !== "available"
    )
      return { ok: false, reason: "That step has no timer to run." };
    const db = context.admin;
    if (a.type === "startTimer") {
      if (!before.timers?.[step.id]) {
        const r = await db
          .from("goal_steps")
          .update({ timer_started_at: new Date(context.now()).toISOString() })
          .eq("goal_id", before.id)
          .eq("step_key", step.id)
          .is("timer_started_at", null);
        if (r.error) throw r.error;
      }
    } else {
      if (E.timerRemaining(before, step.id, context.now()) !== 0)
        return { ok: false, reason: "The timer is still running." };
      // Claim the one-time "Timer done" line so two devices can't both post it.
      const r = await db
        .from("goal_steps")
        .update({ timer_done_posted: true })
        .eq("goal_id", before.id)
        .eq("step_key", step.id)
        .eq("timer_done_posted", false)
        .select("step_key");
      if (r.error) throw r.error;
      if (r.data?.length) after = E.timerDone(before);
    }
  } else if (a.type === "applyPatch" || a.type === "keepPatch") {
    const db = context.admin;
    const { data: row, error } = await db
      .from("plan_patches")
      .select("id,patch,status")
      .eq("id", a.patchId)
      .eq("goal_id", before.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!row || row.status !== "pending")
      return { ok: false, reason: "That plan update is no longer open." };
    if (a.type === "keepPatch") {
      const r = await db
        .from("plan_patches")
        .update({ status: "kept" })
        .eq("id", row.id)
        .eq("status", "pending");
      if (r.error) throw r.error;
      after = E.patchKept(before);
    } else {
      const plan = E.planOf(before);
      const patch = row.patch as unknown as E.PlanPatch;
      // The plan may have moved on since the update was proposed: validate again before applying.
      if (E.validatePatch(plan, before.completed, patch).length) {
        await db.from("plan_patches").update({ status: "kept" }).eq("id", row.id);
        return {
          ok: false,
          reason: "This update no longer fits your progress. Keeping the original plan.",
        };
      }
      const claim = await db
        .from("plan_patches")
        .update({ status: "applied" })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id");
      if (claim.error) throw claim.error;
      if (!claim.data?.length) return { ok: false, reason: "That plan update is no longer open." };
      const next = E.applyPatch(plan, patch);
      const rev = await db.from("plan_revisions").insert({
        goal_id: before.id,
        user_id: context.userId,
        patch_id: row.id,
        plan: plan as unknown as Json,
      });
      if (rev.error) throw rev.error;
      await writePlan(db, context.userId, before, plan, next);
      const rc = await db
        .from("goals")
        .update({ replan_count: (before.replanCount ?? 0) + 1 })
        .eq("id", before.id);
      if (rc.error) throw rc.error;
      after = E.patchApplied(before, next);
    }
  } else if (a.type === "restorePlan") {
    if (!E.replanOpen(before)) return { ok: false, reason: "Nothing to restore right now." };
    const db = context.admin;
    const { data: rev, error } = await db
      .from("plan_revisions")
      .select("id,plan")
      .eq("goal_id", before.id)
      .eq("user_id", context.userId)
      .eq("restored", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!rev) return { ok: false, reason: "No earlier plan to restore." };
    const plan = E.planOf(before);
    const target = E.restorePlan(plan, rev.plan as unknown as Plan, before.completed);
    if (typeof target === "string") return { ok: false, reason: `Can't restore: ${target}` };
    await writePlan(db, context.userId, before, plan, target);
    const r = await db.from("plan_revisions").update({ restored: true }).eq("id", rev.id);
    if (r.error) throw r.error;
    after = E.patchApplied(before, target, "Previous plan restored.");
  } else if (a.type === "pause") {
    if (!E.replanOpen(before)) return { ok: false, reason: "This goal can't be paused now." };
    after = E.goalPaused(before);
  } else if (a.type === "resume") {
    if (!before.paused) return { ok: false, reason: "This goal isn't paused." };
    after = E.goalResumed(before);
  } else if (a.type === "anotherApproach") {
    if (!E.replanOpen(before)) return { ok: false, reason: "Nothing to replan right now." };
    after = E.askReplan(before, "text", undefined, true);
  } else {
    if (!E.planOf(before).steps.every((s) => before.completed.includes(s.id)) || before.achieved)
      return { ok: false, reason: "The Goal check isn't open." };
    after = E.retryCheck(before);
  }
  return after;
}

/** Turns an AI failure or rate limit into one chat line instead of an error. */
function aiFailure(
  before: Goal,
  a: Action | { type: "proof"; stepId: string },
  e: unknown,
): Goal | null {
  const echoed = a.type === "text" ? E.userText(before, a.text) : before;
  if (e instanceof RateLimitError) return E.rateLimited(echoed, e.daily);
  if (e instanceof AiCallError) return E.aiFailed(echoed, JSON.stringify(a));
  return null;
}

/** Chat actions that never mark anything done: typing, picking a goal, Start, I'm stuck, Retry check. */
export async function runGoalAction(deps: Deps, data: ActionInput): Promise<ActionResult> {
  let before = await loadGoal(deps.userDb, data.goalId);
  let a: Action = data.action;
  if (a.type === "retryAi") {
    // Repeat the failed request: remove the error line (and the echoed user text) so nothing is duplicated.
    const last = before.messages[before.messages.length - 1];
    if (last?.kind !== "aiError") return { ok: false, reason: "Nothing to retry." };
    const failed = JSON.parse(last.retry) as Action | { type: "proof" };
    if (failed.type === "proof") return { ok: false, reason: "Submit the proof again." };
    const seqs = [E.seqOf(last.id)];
    const prev = before.messages[before.messages.length - 2];
    if (failed.type === "text" && prev?.role === "user") seqs.push(E.seqOf(prev.id));
    const r = await deps.admin.from("messages").delete().eq("goal_id", before.id).in("seq", seqs);
    if (r.error) throw r.error;
    before = await loadGoal(deps.userDb, data.goalId);
    a = failed;
  }
  let after: Goal;
  let event: LifecycleEvent | undefined = lifecycleEvent(a);
  const rec = recorder();
  try {
    // Life-safety red flags stop here, before any AI call (spec R6). Code rules only. With the
    // lifecycle columns the goal is also put on hold (escalated) until the user confirms safety.
    const stopped = a.type === "text" ? gateText(before, a.text) : null;
    if (stopped && before.lifecyclePersisted && before.status !== "abandoned")
      event = { type: "escalate", reason: stopped.sign };
    const res = stopped?.goal ?? (await dispatch(before, a, { ...deps, rec }));
    if ("ok" in res) return res;
    after = withActivity(before, res, rec.events);
  } catch (e) {
    const failed = aiFailure(before, a, e);
    if (!failed) throw e;
    console.error("AI request failed", e);
    after = failed;
  }
  if (after === before) return { ok: true, goal: await loadGoal(deps.userDb, data.goalId) };
  return commit(deps, before, after, event);
}

/** The explicit lifecycle event an action carries, if any. */
function lifecycleEvent(a: Action): LifecycleEvent | undefined {
  if (a.type === "end") return { type: "end", reason: a.reason };
  if (a.type === "escalate") return { type: "escalate", reason: "Needs a qualified professional" };
  if (a.type === "resolveEscalation") return { type: "resolveEscalation" };
  return undefined;
}

/** Proof and the Goal check are refused while a goal is on hold or ended. */
function lifecycleRefusal(g: Goal): { ok: false; reason: string } | null {
  if (g.status === "abandoned") return { ok: false, reason: "This goal has ended." };
  if (g.status === "escalated") return { ok: false, reason: L.ESCALATED_HOLD_LINE };
  return null;
}

const proofValue = z.union([z.boolean(), z.string().max(1000)]);

export const proofInput = z.object({
  goalId,
  stepId: z.string().max(50),
  acknowledged: z.boolean(),
  values: z.record(z.string().max(50), proofValue),
  override: z.string().trim().min(3).max(200).optional(),
});

/** The only way a step becomes done. */
export async function runSubmitProof(
  deps: Deps,
  data: z.infer<typeof proofInput>,
): Promise<ActionResult> {
  let before = await loadGoal(deps.userDb, data.goalId);
  const held = lifecycleRefusal(before);
  if (held) return held;
  if (!before.planned || !before.started) return { ok: false, reason: "Tap Start to begin." };
  const db = deps.admin;
  if (before.paused) return commit(deps, before, E.pausedLine(before));
  // Retrying a failed photo check: drop the old error line so it isn't duplicated.
  const lastMsg = before.messages[before.messages.length - 1];
  if (lastMsg?.kind === "aiError" && lastMsg.retry.includes(`"proof"`)) {
    const r = await db
      .from("messages")
      .delete()
      .eq("goal_id", before.id)
      .eq("seq", E.seqOf(lastMsg.id));
    if (r.error) throw r.error;
    before = await loadGoal(deps.userDb, data.goalId);
  }
  const plan = E.planOf(before);
  const step = plan.steps.find((s) => s.id === data.stepId);
  if (!step) return { ok: false, reason: "Unknown step." };

  const status = E.stepStatus(step.id, before.completed, plan);
  if (status === "done") {
    // A double tap re-sending the same proof is not an error.
    const sent: Record<string, E.ProofValue> = {};
    for (const it of step.proof) sent[it.id] = data.values[it.id];
    if (E.sameProof(before.proofs[step.id] ?? {}, sent)) return { ok: true, goal: before };
    return { ok: false, reason: `Step ${E.stepNumber(step.id, plan)} is already verified.` };
  }
  if (status === "locked") {
    const first = E.firstUnmetPrereq(step.id, before.completed, plan);
    return { ok: false, reason: `Finish ${first?.title ?? "the earlier steps"} first.` };
  }

  // Keep only this step's declared proof items; drop anything else the browser sent.
  const values: Record<string, E.ProofValue> = {};
  for (const it of step.proof) values[it.id] = data.values[it.id];
  let candidate = E.setAck(before, step.id, data.acknowledged);
  for (const [k, v] of Object.entries(values)) candidate = E.setProof(candidate, step.id, k, v);

  // An offered override (the user can't take the photo) may submit without the photo; all other proof still applies.
  const skipPhoto = !!data.override && !!before.overrideOffered?.[step.id];
  const missing = E.missingProof(candidate, step.id, skipPhoto);
  if (missing.length) return { ok: false, reason: E.fitList("Not yet. Missing proof:", missing) };
  if (E.timerBlocks(candidate, step.id, deps.now()))
    return { ok: false, reason: "Not yet. Wait for the timer to finish." };

  // Photo values are storage paths; they must sit in this user's folder for this goal.
  const photoItems = step.proof.filter((it) => it.kind === "photo");
  if (photoItems.length > MAX_PHOTOS_PER_STEP)
    return { ok: false, reason: `A step can check at most ${MAX_PHOTOS_PER_STEP} photos.` };
  const prefix = `${deps.userId}/${before.id}/`;
  for (const it of photoItems) {
    const v = values[it.id];
    if (skipPhoto && (v === undefined || v === "")) continue;
    if (typeof v !== "string" || !v.startsWith(prefix) || v.includes(".."))
      return { ok: false, reason: `Upload the photo again: ${it.label}` };
  }

  let lastPhotoEvents: ActivityEvent[] = [];
  if (data.override) {
    if (before.overrides?.[step.id])
      return { ok: false, reason: "You already overrode this step." };
    if (!E.canOverride(before, step.id))
      return { ok: false, reason: "Override isn't available for this step yet." };
    const r = await db.from("proof_overrides").insert({
      goal_id: before.id,
      user_id: deps.userId,
      step_key: step.id,
      reason: data.override,
    });
    if (r.error) throw r.error;
  } else if (photoItems.length) {
    // The AI only returns a verdict; this function still decides whether the step becomes done.
    let images: string[];
    try {
      images = await Promise.all(photoItems.map((it) => photoDataUrl(db, values[it.id] as string)));
    } catch (e) {
      if (e instanceof PhotoTooBig)
        return { ok: false, reason: "Photo is over 5 MB. Upload a smaller one." };
      console.error("photo download failed", e);
      return { ok: false, reason: "Couldn't read your photo. Upload it again." };
    }
    let result;
    const photoRec = recorder();
    try {
      result = await photoRec.step("do", LABELS.photo, () =>
        deps.ai.aiPhotoCheck(deps.userId, before.id, step, values, images),
      );
    } catch (e) {
      const failed = aiFailure(before, { type: "proof", stepId: step.id }, e);
      if (!failed) throw e;
      console.error("photo check failed", e);
      return commit(deps, before, failed);
    }
    const r = await db.from("photo_checks").insert({
      goal_id: before.id,
      user_id: deps.userId,
      step_key: step.id,
      verdict: result.verdict,
      missing_items: result.missing_items,
      reason: result.reason,
    });
    if (r.error) throw r.error;
    lastPhotoEvents = photoRec.events;
    if (result.verdict !== "verified") {
      const fallback = photoItems.map((it) => it.label);
      const next =
        result.verdict === "missing"
          ? E.photoMissing(before, result.missing_items.length ? result.missing_items : fallback)
          : E.photoUnclear(before, result.reason || fallback.join(", "));
      return commit(deps, before, withActivity(before, next, photoRec.events));
    }
  }

  const after = withActivity(before, E.submitProof(candidate, step.id, skipPhoto), lastPhotoEvents);
  return commit(deps, before, after);
}

export const checkInput = z.object({
  goalId,
  value: z.string().max(50).optional(),
  answers: z.record(z.string().max(50), z.enum(["pass", "fail"])).optional(),
});

/** The only way a goal becomes achieved. */
export async function runSubmitGoalCheck(
  deps: Deps,
  data: z.infer<typeof checkInput>,
): Promise<ActionResult> {
  const before = await loadGoal(deps.userDb, data.goalId);
  const held = lifecycleRefusal(before);
  if (held) return held;
  const plan = E.planOf(before);
  if (before.paused) return commit(deps, before, E.pausedLine(before));
  // A double tap re-sending the answers that already passed is not an error.
  if (before.achieved) {
    const { data: last } = await deps.userDb
      .from("goal_check_results")
      .select("answers")
      .eq("goal_id", before.id)
      .eq("passed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sent = plan.check.kind === "rise" ? { value: data.value ?? "" } : (data.answers ?? {});
    if (last && E.sameProof(last.answers as Record<string, E.ProofValue>, sent))
      return { ok: true, goal: before };
  }
  if (
    !before.planned ||
    before.achieved ||
    !plan.steps.every((s) => before.completed.includes(s.id))
  )
    return { ok: false, reason: "The Goal check isn't open." };

  let candidate = E.setCheckValue(before, data.value ?? "");
  if (plan.check.kind === "passfail") {
    for (const it of plan.check.items)
      candidate = E.setCheckProof(candidate, it.id, data.answers?.[it.id]);
  }
  if (!E.checkReady(candidate))
    return { ok: false, reason: "Not yet. Answer every Goal check item." };

  let after = E.submitCheck(candidate);
  // A failed Goal check starts replanning (or offers alternatives after the replan limit).
  if (!after.achieved && after !== candidate) after = E.askReplan(after, "check");
  const db = deps.admin;
  const answers =
    plan.check.kind === "rise" ? { value: candidate.checkValue } : (candidate.checkProofs ?? {});
  const r = await db
    .from("goal_check_results")
    .insert({ goal_id: before.id, user_id: deps.userId, passed: after.achieved, answers });
  if (r.error) throw r.error;
  return commit(deps, before, after);
}

class PhotoTooBig extends Error {}

/** Downloads a private proof photo and returns it as a data URL for the AI. */
async function photoDataUrl(db: Db, path: string): Promise<string> {
  const { data, error } = await db.storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) throw error ?? new Error("Photo not found");
  if (data.size > MAX_PHOTO_BYTES) throw new PhotoTooBig();
  const bytes = new Uint8Array(await data.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${data.type || "image/jpeg"};base64,${btoa(bin)}`;
}
