import { PHONE_PLAN, PLANS, type Plan, type ProofItem, type Step } from "./plan";
import { limitWords, wordCount } from "./text";

export type ProofValue = boolean | string | "pass" | "fail" | undefined;

export type Msg =
  | { id: string; role: "user"; kind: "text"; text: string }
  | { id: string; role: "assistant"; kind: "text"; text: string }
  | { id: string; role: "assistant"; kind: "goal" }
  | { id: string; role: "assistant"; kind: "tasks"; stepIds: string[] }
  | { id: string; role: "assistant"; kind: "intake"; question: string; options: string[] }
  | { id: string; role: "assistant"; kind: "check" }
  | { id: string; role: "assistant"; kind: "checkFail" }
  | { id: string; role: "assistant"; kind: "recap" }
  | { id: string; role: "assistant"; kind: "replanAsk"; question: string; options: string[] }
  | { id: string; role: "assistant"; kind: "patch"; patchId: string }
  | { id: string; role: "assistant"; kind: "replanLimit" }
  /** An AI call failed; `retry` is the JSON of the request to repeat. */
  | { id: string; role: "assistant"; kind: "aiError"; retry: string }
  /** Display-only record of what the agent did (see activity.ts). */
  | { id: string; role: "assistant"; kind: "setup" }
  | { id: string; role: "assistant"; kind: "approach" }
  | { id: string; role: "assistant"; kind: "escalation" }
  | {
      id: string;
      role: "assistant";
      kind: "activity";
      events: import("./activity").ActivityEvent[];
    };

/** Before/after summary of a plan update, for the "Plan update" card. */
export interface PatchSummary {
  added: string[];
  changed: string[];
  removed: string[];
}

export interface PatchInfo {
  status: "pending" | "applied" | "kept";
  summary: PatchSummary;
  reason: string;
}

/** One intake question the assistant asked and the user's answer. */
export interface IntakeAnswer {
  q: string;
  a: string;
}

export interface Goal {
  id: string;
  /** Which plan this goal follows; missing on goals saved before multi-plan support. */
  planId?: string;
  /** The goal's own copy of its plan (from the database); falls back to the built-in template. */
  plan?: Plan;
  /** True when the plan was written by the AI for this goal instead of a built-in template. */
  custom?: boolean;
  /** Intake questions already answered for a custom goal. */
  intake?: IntakeAnswer[];
  /** Case method state (frame, setup answers, brief, escalation) for custom goals. */
  caseData?: import("./casefw").CaseData | null;
  planned: boolean;
  started: boolean;
  completed: string[];
  ack: Record<string, boolean>;
  proofs: Record<string, Record<string, ProofValue>>;
  checkValue: string;
  /** Answers for pass/fail goal checks. */
  checkProofs?: Record<string, ProofValue>;
  achieved: boolean;
  /** Server-stored timer start (ISO) per step with a wait. */
  timers?: Record<string, string>;
  /** Steps whose "Timer done" line was already posted. */
  timerPosted?: Record<string, boolean>;
  /** Latest AI photo verdict per step. */
  verdicts?: Record<string, PhotoVerdict>;
  /** Consecutive "unclear" photo verdicts per step (latest run). */
  unclearStreak?: Record<string, number>;
  /** Override reason per step (the user overrode the photo check). */
  overrides?: Record<string, string>;
  /** "I'm stuck" taps per step since the last replan question. */
  stuckCounts?: Record<string, number>;
  /** Plan updates applied to this goal. */
  replanCount?: number;
  paused?: boolean;
  /** Proposed plan updates by id. */
  patches?: Record<string, PatchInfo>;
  /** Steps where the user said they can't take the photo, so an override was offered. */
  overrideOffered?: Record<string, boolean>;
  /** Saved earlier plans that can still be restored. */
  revisions?: number;
  /** Lifecycle status (see lifecycle.ts). Set by the server on load; never by the AI. */
  status?: import("./lifecycle").GoalStatus;
  /** Why the goal is escalated or ended, as recorded. */
  statusReason?: string | null;
  /** True once the lifecycle columns exist in the database (ADR-0001 migration applied). */
  lifecyclePersisted?: boolean;
  messages: Msg[];
  seq: number;
}

export type PhotoVerdict = "verified" | "missing" | "unclear";

export type StepStatus = "locked" | "available" | "done";

export const plan: Plan = PHONE_PLAN;

export function getPlan(id: string | undefined): Plan {
  return PLANS.find((p) => p.id === id) ?? PHONE_PLAN;
}

export function planOf(g: Goal): Plan {
  return g.plan ?? getPlan(g.planId);
}

/** Lower-cased whole words of a text; possessive "'s" is dropped ("phone's" -> "phone"). */
export function textWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9*]+/)
    .filter(Boolean);
}

/**
 * True when every token of `phrase` is a whole word of the text (any order).
 * A token ending in "*" matches a word prefix: "charg*" matches charge, charger, charging.
 */
export function phraseMatches(phrase: string, words: string[]): boolean {
  const tokens = textWords(phrase);
  return (
    tokens.length > 0 &&
    tokens.every((t) =>
      t.endsWith("*") ? words.some((w) => w.startsWith(t.slice(0, -1))) : words.includes(t),
    )
  );
}

/**
 * The built-in template whose match phrases fit the text, if any. Precision over recall: a miss falls
 * through to the general custom-goal intake, while a false hit would push the user into an unrelated plan.
 */
export function planForText(text: string, plans: Plan[] = PLANS): Plan | null {
  const words = textWords(text.replace(/\*/g, " "));
  return plans.find((p) => p.keywords.some((k) => phraseMatches(k, words))) ?? null;
}

export function getStep(id: string, p: Plan = plan): Step {
  const s = p.steps.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown step ${id}`);
  return s;
}

export function stepNumber(id: string, p: Plan = plan): number {
  return p.steps.findIndex((s) => s.id === id) + 1;
}

export function stepStatus(id: string, completed: string[], p: Plan = plan): StepStatus {
  if (completed.includes(id)) return "done";
  return getStep(id, p).prereqs.every((r) => completed.includes(r)) ? "available" : "locked";
}

export function availableSteps(completed: string[], p: Plan = plan): string[] {
  return p.steps.filter((s) => stepStatus(s.id, completed, p) === "available").map((s) => s.id);
}

export function newlyUnlocked(before: string[], after: string[], p: Plan = plan): string[] {
  const was = new Set(availableSteps(before, p));
  return availableSteps(after, p).filter((id) => !was.has(id));
}

/** Groups steps by dependency depth, for the plan panel. */
export function stepLevels(p: Plan = plan): string[][] {
  const depth: Record<string, number> = {};
  const d = (id: string): number => {
    if (depth[id] !== undefined) return depth[id];
    const s = getStep(id, p);
    depth[id] = s.prereqs.length ? Math.max(...s.prereqs.map(d)) + 1 : 0;
    return depth[id];
  };
  const levels: string[][] = [];
  p.steps.forEach((s) => (levels[d(s.id)] ??= []).push(s.id));
  return levels;
}

export function firstUnmetPrereq(id: string, completed: string[], p: Plan = plan): Step | null {
  const s = getStep(id, p);
  const missing = s.prereqs.find((r) => !completed.includes(r));
  return missing ? getStep(missing, p) : null;
}

export function itemSatisfied(
  item: Pick<ProofItem, "kind" | "min" | "max">,
  v: ProofValue,
): boolean {
  const { kind } = item;
  if (kind === "check") return v === true;
  if (kind === "text" || kind === "photo") return typeof v === "string" && v.trim().length > 0;
  if (kind === "passfail") return v === "pass" || v === "fail";
  if (kind === "number") {
    if (typeof v !== "string" || v.trim() === "") return false;
    const num = Number(v);
    if (!Number.isFinite(num)) return false;
    if (item.min !== undefined && num < item.min) return false;
    if (item.max !== undefined && num > item.max) return false;
    return true;
  }
  return false;
}

export function missingProof(goal: Goal, id: string, skipPhoto = false): string[] {
  const s = getStep(id, planOf(goal));
  const vals = goal.proofs[id] ?? {};
  const out: string[] = [];
  if (s.safety && !goal.ack[id]) out.push("I understand");
  s.proof.forEach((it) => {
    if (skipPhoto && it.kind === "photo") return;
    if (!itemSatisfied(it, vals[it.id])) out.push(it.label);
  });
  return out;
}

export function progress(goal: Goal) {
  const done = goal.completed.length;
  const total = planOf(goal).steps.length;
  const { percent } = goalSummary({
    planned: goal.planned,
    started: goal.started,
    paused: !!goal.paused,
    achieved: goal.achieved,
    done,
    total,
  });
  return { done, total, percent };
}

/** The coarse statuses the goal list can tell from flags alone (no messages or timers loaded). */
export type GoalListStatus = Extract<
  import("./lifecycle").GoalStatus,
  "draft" | "understanding" | "active" | "paused" | "verifying" | "achieved"
>;

/**
 * Percent and coarse status for a goal. The final Goal check counts as one unit of work, so a goal whose
 * steps are all done but whose check hasn't passed is below 100%: only a passed check is 100%.
 * When the lifecycle column exists the goal list uses the stored status instead of this one.
 */
export function goalSummary(f: {
  planned: boolean;
  started: boolean;
  paused: boolean;
  achieved: boolean;
  done: number;
  total: number;
  /** Any message saved yet (unplanned goals): distinguishes "draft" from "understanding". */
  hasInput?: boolean;
}): { percent: number; status: GoalListStatus } {
  const percent = f.achieved
    ? 100
    : f.planned && f.total > 0
      ? Math.min(99, Math.round((Math.min(f.done, f.total) / (f.total + 1)) * 100))
      : 0;
  const status: GoalListStatus = f.achieved
    ? "achieved"
    : !f.planned
      ? f.hasInput === false
        ? "draft"
        : "understanding"
      : f.paused
        ? "paused"
        : f.started && f.total > 0 && f.done >= f.total
          ? "verifying"
          : "active";
  return { percent, status };
}

export function goalCheckPasses(before: string | undefined, after: string, rise = 5): boolean {
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || after.trim() === "" || !Number.isFinite(a)) return false;
  return a >= b + rise;
}

/** Pass/fail goal checks pass only when every item is "pass". */
export function passFailCheckPasses(items: ProofItem[], vals: Record<string, ProofValue>): boolean {
  return items.every((it) => vals[it.id] === "pass");
}

export function checkReady(g: Goal): boolean {
  const c = planOf(g).check;
  if (c.kind === "rise") return itemSatisfied({ kind: "number" }, g.checkValue);
  const vals = g.checkProofs ?? {};
  return c.items.every((it) => itemSatisfied(it, vals[it.id]));
}

export function recapLine(goal: Goal, id: string): string {
  const p = planOf(goal);
  const v = goal.proofs[id] ?? {};
  const n = stepNumber(id, p);
  const s = getStep(id, p);
  if (s.recap) {
    return s.recap.replace(/\{(\w+)\}/g, (_, k: string) =>
      k === "n" ? String(n) : String(v[k] ?? "").trim(),
    );
  }
  return `Step ${n}: ${s.title}.`;
}

// ---------- AI plan validation ----------

/** The raw JSON shape the AI returns in PLAN mode. */
export interface AiPlan {
  goal: string;
  done_means: string;
  steps: {
    id: string;
    title: string;
    est_minutes: number;
    safety_note: string | null;
    actions: string[];
    why: string;
    hint: string;
    prerequisites: string[];
    proof: { label: string; type: string; min: number | null; max: number | null }[];
    wait_seconds: number | null;
  }[];
  goal_check: { label: string; type: string; min: number | null; max: number | null }[];
}

const OBJECTIVE_KINDS = new Set(["number", "passfail", "photo"]);
const PROOF_KINDS = new Set(["checkbox", "number", "text", "passfail", "photo"]);

/** Validates raw AI plan JSON against the plan rules. Returns a list of problems (empty = valid). */
export function validateAiPlan(raw: unknown): string[] {
  const errors: string[] = [];
  if (raw === null || typeof raw !== "object") return ["The plan is not a JSON object."];
  const p = raw as Partial<AiPlan>;
  if (typeof p.goal !== "string" || !p.goal.trim()) errors.push("Missing goal.");
  if (typeof p.done_means !== "string" || !p.done_means.trim()) errors.push("Missing done_means.");
  if (!Array.isArray(p.steps)) return [...errors, "Missing steps array."];

  if (p.steps.length < 4 || p.steps.length > 10)
    errors.push(`Plan has ${p.steps.length} steps; it must have 4 to 10.`);

  const ids = new Set<string>();
  for (const s of p.steps) {
    if (!s || typeof s.id !== "string" || !s.id.trim()) {
      errors.push("A step is missing its id.");
      continue;
    }
    if (ids.has(s.id)) errors.push(`Duplicate step id "${s.id}".`);
    ids.add(s.id);
  }

  for (const s of p.steps) {
    if (!s || typeof s.id !== "string") continue;
    const label = `Step "${s.id}"`;
    if (typeof s.title !== "string" || !s.title.trim()) errors.push(`${label} is missing a title.`);
    if (!Array.isArray(s.actions) || s.actions.length < 1 || s.actions.length > 3)
      errors.push(`${label} must have 1 to 3 actions.`);
    if (!Array.isArray(s.prerequisites)) {
      errors.push(`${label} is missing prerequisites.`);
    } else {
      for (const r of s.prerequisites)
        if (!ids.has(r)) errors.push(`${label} lists unknown prerequisite "${r}".`);
    }
    if (!Array.isArray(s.proof) || s.proof.length < 2 || s.proof.length > 4) {
      errors.push(`${label} must have 2 to 4 proof items.`);
    } else {
      for (const it of s.proof)
        if (!it || typeof it.label !== "string" || !PROOF_KINDS.has(it.type))
          errors.push(`${label} has a proof item with a missing label or bad type.`);
      if (!s.proof.some((it) => it && OBJECTIVE_KINDS.has(it.type)))
        errors.push(
          `${label} needs at least one objective proof item (number, pass/fail or photo).`,
        );
    }
  }

  // Traverse every branch, including cycles hidden behind a valid first prerequisite.
  const validSteps = p.steps.filter((s) => s && typeof s.id === "string");
  const prerequisites = new Map(
    validSteps.map((s) => [s.id, Array.isArray(s.prerequisites) ? s.prerequisites : []]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of prerequisites.get(id) ?? []) {
      if (prerequisites.has(next) && cycle(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (validSteps.some((s) => cycle(s.id))) errors.push("Circular dependency in plan.");

  if (!Array.isArray(p.goal_check) || p.goal_check.length < 1 || p.goal_check.length > 3) {
    errors.push("goal_check must have 1 to 3 items.");
  } else {
    for (const it of p.goal_check)
      if (!it || typeof it.label !== "string" || !PROOF_KINDS.has(it.type))
        errors.push("A goal_check item has a missing label or bad type.");
  }
  return errors;
}

type AiStep = AiPlan["steps"][number];

/** Maps one validated AI step onto the app's Step shape. */
export function aiStepToStep(s: AiStep): Step {
  const kindOf = (t: string): ProofItem["kind"] =>
    t === "checkbox" ? "check" : (t as ProofItem["kind"]);
  const step: Step = {
    id: s.id,
    title: s.title,
    minutes: Math.max(1, Math.round(Number(s.est_minutes) || 10)),
    prereqs: s.prerequisites,
    actions: s.actions.slice(0, 3),
    proof: s.proof.map((it, i) => {
      const item: ProofItem = { id: `p${i + 1}`, label: it.label, kind: kindOf(it.type) };
      if (it.min !== null && Number.isFinite(it.min)) item.min = it.min;
      if (it.max !== null && Number.isFinite(it.max)) item.max = it.max;
      return item;
    }),
    hint: s.hint,
    why: s.why,
  };
  if (s.safety_note) step.safety = s.safety_note;
  if (s.wait_seconds !== null && s.wait_seconds !== undefined && Number.isFinite(s.wait_seconds))
    step.waitSeconds = s.wait_seconds;
  return step;
}

/** Maps validated AI plan JSON onto the app's Plan shape. Call only when validateAiPlan returned no errors. */
export function aiPlanToPlan(raw: AiPlan, id: string): Plan {
  return {
    id,
    title: raw.goal.trim(),
    goal: raw.goal.trim(),
    doneMeans: raw.done_means.trim(),
    keywords: [],
    steps: raw.steps.map(aiStepToStep),
    check: {
      kind: "passfail",
      items: raw.goal_check.map((it, i) => ({
        id: `c${i + 1}`,
        label: it.label,
        kind: "passfail" as const,
      })),
    },
  };
}

// ---------- replanning ----------

/** The raw JSON shape the AI returns in REPLAN mode. */
export interface PlanPatch {
  add_steps: AiStep[];
  modify_steps: AiStep[];
  remove_steps: string[];
  reason: string;
}

/** Same proof rules as a new AI plan, for one step. */
function validateAiStep(s: AiStep, errors: string[]) {
  const label = `Step "${s.id}"`;
  if (typeof s.title !== "string" || !s.title.trim()) errors.push(`${label} is missing a title.`);
  if (
    !Array.isArray(s.actions) ||
    s.actions.length < 1 ||
    s.actions.length > 3 ||
    s.actions.some((a) => typeof a !== "string")
  )
    errors.push(`${label} must have 1 to 3 actions.`);
  if (!Array.isArray(s.prerequisites)) errors.push(`${label} is missing prerequisites.`);
  if (typeof s.hint !== "string" || typeof s.why !== "string")
    errors.push(`${label} needs a hint and a why.`);
  if (!Array.isArray(s.proof) || s.proof.length < 2 || s.proof.length > 4) {
    errors.push(`${label} must have 2 to 4 proof items.`);
  } else {
    for (const it of s.proof)
      if (!it || typeof it.label !== "string" || !PROOF_KINDS.has(it.type))
        errors.push(`${label} has a proof item with a missing label or bad type.`);
    if (!s.proof.some((it) => it && OBJECTIVE_KINDS.has(it.type)))
      errors.push(`${label} needs at least one objective proof item (number, pass/fail or photo).`);
  }
}

/**
 * A changed open step must keep every photo and number proof item it had (number ranges may only get
 * stricter) and any wait timer may not get shorter. Returns problems (empty = not weakened).
 */
export function weakensProof(old: Step, next: Step): string[] {
  const errors: string[] = [];
  const label = `Step "${old.id}"`;
  const photos = (s: Step) => s.proof.filter((it) => it.kind === "photo").length;
  if (photos(next) < photos(old))
    errors.push(`${label} must keep its ${photos(old)} photo proof item(s).`);
  const pool = next.proof.filter((it) => it.kind === "number");
  const fits = (o: ProofItem, n: ProofItem) =>
    (o.min === undefined || (n.min !== undefined && n.min >= o.min)) &&
    (o.max === undefined || (n.max !== undefined && n.max <= o.max));
  for (const o of old.proof.filter((it) => it.kind === "number")) {
    const i =
      pool.findIndex((n) => n.label === o.label && fits(o, n)) >= 0
        ? pool.findIndex((n) => n.label === o.label && fits(o, n))
        : pool.findIndex((n) => fits(o, n));
    if (i < 0)
      errors.push(
        `${label} must keep number proof "${o.label}" with the same or a stricter range.`,
      );
    else pool.splice(i, 1);
  }
  if (old.waitSeconds && (!next.waitSeconds || next.waitSeconds < old.waitSeconds))
    errors.push(`${label} must keep its ${old.waitSeconds}-second timer.`);
  return errors;
}

/** True when following prerequisites from any step leads back to itself. */
export function hasCycle(p: Plan): boolean {
  const pre = new Map(p.steps.map((s) => [s.id, s.prereqs]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    const st = state.get(id);
    if (st === 1) return true;
    if (st === 2) return false;
    state.set(id, 1);
    for (const r of pre.get(id) ?? []) if (pre.has(r) && visit(r)) return true;
    state.set(id, 2);
    return false;
  };
  return p.steps.some((s) => visit(s.id));
}

/** Applies a patch to a plan. Kept steps stay in order; modified steps keep their place; added steps go last. */
export function applyPatch(p: Plan, patch: PlanPatch): Plan {
  const removed = new Set(patch.remove_steps);
  const mods = new Map(patch.modify_steps.map((s) => [s.id, aiStepToStep(s)]));
  const steps = p.steps.filter((s) => !removed.has(s.id)).map((s) => mods.get(s.id) ?? s);
  return { ...p, steps: [...steps, ...patch.add_steps.map(aiStepToStep)] };
}

/**
 * Validates a raw AI plan patch against the current plan before anything is shown.
 * Returns a list of problems (empty = valid).
 */
export function validatePatch(p: Plan, completed: string[], raw: unknown): string[] {
  if (raw === null || typeof raw !== "object") return ["The patch is not a JSON object."];
  const x = raw as Partial<PlanPatch>;
  const errors: string[] = [];
  if (
    !Array.isArray(x.add_steps) ||
    !Array.isArray(x.modify_steps) ||
    !Array.isArray(x.remove_steps)
  )
    return ["The patch needs add_steps, modify_steps and remove_steps arrays."];
  if (typeof x.reason !== "string" || !x.reason.trim()) errors.push("Missing reason.");
  else if (x.reason.trim().split(/\s+/).length > 20)
    errors.push("Reason must be at most 20 words.");
  if (!x.add_steps.length && !x.modify_steps.length && !x.remove_steps.length)
    errors.push("The patch changes nothing.");

  const existing = new Set(p.steps.map((s) => s.id));
  const done = new Set(completed);
  const touched = new Set<string>();
  for (const id of x.remove_steps) {
    if (typeof id !== "string" || !existing.has(id))
      errors.push(`Cannot remove unknown step "${id}".`);
    else if (done.has(id)) errors.push(`Step "${id}" is done and cannot be removed.`);
    touched.add(id);
  }
  for (const s of x.modify_steps) {
    if (!s || typeof s.id !== "string" || !existing.has(s.id)) {
      errors.push(`Cannot modify unknown step "${s?.id}".`);
      continue;
    }
    if (done.has(s.id)) errors.push(`Step "${s.id}" is done and cannot be changed.`);
    if (touched.has(s.id)) errors.push(`Step "${s.id}" is changed twice.`);
    touched.add(s.id);
    validateAiStep(s, errors);
    if (Array.isArray(s.proof) && Array.isArray(s.prerequisites) && Array.isArray(s.actions))
      errors.push(...weakensProof(getStep(s.id, p), aiStepToStep(s)));
  }
  const newIds = new Set<string>();
  for (const s of x.add_steps) {
    if (!s || typeof s.id !== "string" || !s.id.trim()) {
      errors.push("An added step is missing its id.");
      continue;
    }
    if (existing.has(s.id) || newIds.has(s.id))
      errors.push(`Added step id "${s.id}" is already used.`);
    newIds.add(s.id);
    validateAiStep(s, errors);
  }
  if (errors.length) return errors;

  const next = applyPatch(p, x as PlanPatch);
  const ids = new Set(next.steps.map((s) => s.id));
  for (const s of next.steps)
    for (const r of s.prereqs)
      if (!ids.has(r)) errors.push(`Step "${s.id}" lists unknown prerequisite "${r}".`);
  if (hasCycle(next)) errors.push("The updated plan has a circular dependency.");
  if (next.steps.length > 15) errors.push("The updated plan has more than 15 steps.");
  if (errors.length) return errors;

  // Replanning never unlocks anything by itself: a kept step that was locked stays locked.
  const before = new Set(availableSteps(completed, p));
  for (const s of next.steps) {
    if (!existing.has(s.id) || done.has(s.id) || before.has(s.id)) continue;
    if (stepStatus(s.id, completed, next) === "available")
      errors.push(`The patch would unlock step "${s.id}".`);
  }
  if (next.steps.every((s) => done.has(s.id)))
    errors.push("The updated plan must leave at least one step to do.");
  return errors;
}

/** Before/after lines for the "Plan update" card. */
export function patchSummary(p: Plan, patch: PlanPatch): PatchSummary {
  return {
    added: patch.add_steps.map((s) => s.title),
    changed: patch.modify_steps.map((s) => {
      const old = getStep(s.id, p).title;
      return old === s.title ? s.title : `${old} → ${s.title}`;
    }),
    removed: patch.remove_steps.map((id) => getStep(id, p).title),
  };
}

const sameStep = (a: Step, b: Step) => JSON.stringify(a) === JSON.stringify(b);

export function stepToAi(s: Step): AiStep {
  return {
    id: s.id,
    title: s.title,
    est_minutes: s.minutes,
    safety_note: s.safety ?? null,
    actions: s.actions,
    why: s.why,
    hint: s.hint,
    prerequisites: s.prereqs,
    proof: s.proof.map((it) => ({
      label: it.label,
      type: it.kind === "check" ? "checkbox" : it.kind,
      min: it.min ?? null,
      max: it.max ?? null,
    })),
    wait_seconds: s.waitSeconds ?? null,
  };
}

/** Checks an earlier plan can be restored: done steps unchanged, no cycles, nothing unlocked. Returns the plan or a reason. */
export function restorePlan(current: Plan, target: Plan, completed: string[]): Plan | string {
  const done = new Set(completed);
  const tgt = new Map(target.steps.map((s) => [s.id, s]));
  for (const s of current.steps) {
    if (!done.has(s.id)) continue;
    const t = tgt.get(s.id);
    if (!t) return `Step ${stepNumber(s.id, current)} is done and isn't in the previous plan.`;
    if (!sameStep(s, t))
      return `Step ${stepNumber(s.id, current)} is done and differs in the previous plan.`;
  }
  if (hasCycle(target)) return "The previous plan is invalid.";
  if (target.steps.every((s) => done.has(s.id)))
    return "The previous plan has no steps left to do.";
  const before = new Set(availableSteps(completed, current));
  for (const s of target.steps) {
    if (!current.steps.some((c) => c.id === s.id) || done.has(s.id) || before.has(s.id)) continue;
    if (stepStatus(s.id, completed, target) === "available")
      return "Restoring would unlock a step.";
  }
  return target;
}

/** Max words for any fixed assistant line outside a card. */
export const LINE_WORDS = 25;

/**
 * "Prefix a, b, c +N more" kept within the 25-word limit: at most 3 items, fewer if they don't fit;
 * a single overlong item is cut with "…".
 */
export function fitList(prefix: string, items: string[], max = LINE_WORDS): string {
  const budget = max - wordCount(prefix);
  const shown: string[] = [];
  for (const it of items.slice(0, 3)) {
    const rest = items.length - shown.length - 1;
    const tail = rest > 0 ? 2 : 0; // "+N more"
    if (wordCount([...shown, it].join(", ")) + tail > budget) break;
    shown.push(it);
  }
  if (!shown.length) {
    const tail = items.length > 1 ? 2 : 0;
    shown.push(limitWords(items[0] ?? "", Math.max(1, budget - tail)).replace(/\.$/, ""));
  }
  const more = items.length - shown.length;
  return `${prefix} ${shown.join(", ")}${more > 0 ? ` +${more} more` : ""}`;
}

/** Same proof values as already stored (a repeated submission). */
export function sameProof(
  stored: Record<string, ProofValue>,
  sent: Record<string, ProofValue>,
): boolean {
  const keys = new Set([...Object.keys(stored), ...Object.keys(sent)]);
  for (const k of keys) if ((stored[k] ?? undefined) !== (sent[k] ?? undefined)) return false;
  return true;
}

export const PAUSED_LINE = "This goal is paused. Resume it first.";

export function pausedLine(g: Goal): Goal {
  return push(g, say(PAUSED_LINE));
}

export const RATE_LINE = "You're going fast. Try again in a moment.";
export const DAILY_LINE = "Daily limit reached. Come back tomorrow.";
export const AI_FAIL_LINE = "Couldn't reach the assistant. Try again.";

/** A rate limit was hit; nothing was sent to the AI. */
export function rateLimited(g: Goal, daily: boolean): Goal {
  return push(g, say(daily ? DAILY_LINE : RATE_LINE));
}

/** An AI call failed; the chat shows one line with a Retry button. */
export function aiFailed(g: Goal, retry: string): Goal {
  return push(g, { role: "assistant", kind: "aiError", retry });
}

export function seqOf(msgId: string): number {
  return Number(msgId.split("-").pop() ?? 0);
}

export const REPLAN_LIMIT = 3;

/** The user says they can't take the photo. */
export function isNoPhotoText(text: string): boolean {
  return /\b(can'?t|cannot|can not|unable to|won'?t be able to)\b.{0,20}\b(photo|picture|pic)\b|\bno (camera|phone camera)\b|\bdon'?t have a camera\b/i.test(
    text,
  );
}

/** The open step that needs a photo, if any. */
export function openPhotoStep(g: Goal): string | null {
  const p = planOf(g);
  return availableSteps(g.completed, p).find((id) => hasPhotoProof(getStep(id, p))) ?? null;
}

/** Reply when the user can't take a photo: offer the one-time override. */
export function offerOverride(g: Goal, stepId: string): Goal {
  return reshowOpen(
    push(
      { ...g, overrideOffered: { ...(g.overrideOffered ?? {}), [stepId]: true } },
      say("This step needs a photo. You can override once with a reason."),
    ),
  );
}

/** One override per photo step, offered after a "missing" verdict, two "unclear" in a row, or when the user can't take the photo. */
export function canOverride(g: Goal, stepId: string): boolean {
  const s = getStep(stepId, planOf(g));
  if (!hasPhotoProof(s) || g.overrides?.[stepId]) return false;
  if (g.overrideOffered?.[stepId]) return true;
  const v = g.verdicts?.[stepId];
  return v === "missing" || (v === "unclear" && (g.unclearStreak?.[stepId] ?? 0) >= 2);
}

/** Text that means the step or plan didn't go as expected. */
export function isReplanText(text: string): boolean {
  return /\b(did ?n[o']?t work|does ?n[o']?t work|not working|won'?t work|it'?s different|is different|looks different|different (part|model|one|from)|wrong part|does ?n[o']?t fit|did ?n[o']?t fit|failed|broke)\b/i.test(
    text,
  );
}

/** True when a step or the Goal check is open, so replanning applies. */
export function replanOpen(g: Goal): boolean {
  return g.planned && g.started && !g.achieved && !g.paused;
}

/** The last replan question still waiting for an answer. */
export function pendingReplanAsk(g: Goal): string | null {
  const last = g.messages[g.messages.length - 1];
  return last && last.kind === "replanAsk" ? last.question : null;
}

/** The second "I'm stuck" tap on a step starts replanning. */
export function stuckTriggersReplan(g: Goal, stepId: string): boolean {
  return (g.stuckCounts?.[stepId] ?? 0) + 1 >= 2;
}

/** Asks one question (max 20 words) with quick replies, or says the replan limit was reached. */
export function askReplan(
  g: Goal,
  trigger: "stuck" | "check" | "text",
  stepId?: string,
  force = false,
): Goal {
  if (!force && (g.replanCount ?? 0) >= REPLAN_LIMIT)
    return push(g, { role: "assistant", kind: "replanLimit" });
  const p = planOf(g);
  if (trigger === "stuck" && stepId)
    return push(g, {
      role: "assistant",
      kind: "replanAsk",
      question: `What's blocking you on Step ${stepNumber(stepId, p)}?`,
      options: [
        "Missing a tool or part",
        "The step didn't work",
        "Part looks different",
        "I don't understand it",
      ],
    });
  if (trigger === "check")
    return push(g, {
      role: "assistant",
      kind: "replanAsk",
      question: "The Goal check failed. What happened?",
      options: ["Close, but not there", "Something broke", "A part is different", "Not sure"],
    });
  return push(g, {
    role: "assistant",
    kind: "replanAsk",
    question: force ? "What should change about the approach?" : "What happened?",
    options: force
      ? ["Use different tools", "Simpler method", "Different parts", "Smaller first goal"]
      : ["The step didn't work", "A part is different", "Missing a tool", "Got an error"],
  });
}

/** Posts the "Plan update" card for a validated, saved patch. */
export function proposePatch(g: Goal, patchId: string): Goal {
  return push(g, { role: "assistant", kind: "patch", patchId });
}

/** The AI could not produce a valid patch. */
export function replanFailed(g: Goal): Goal {
  return reshowOpen(push(g, say("I couldn't update the plan safely.")));
}

/** Swaps in the updated plan. Completed steps, proof and achievement are untouched. */
export function patchApplied(g: Goal, next: Plan, line = "Plan updated."): Goal {
  return reshowOpen(push({ ...g, plan: next }, say(line)));
}

export function patchKept(g: Goal): Goal {
  return reshowOpen(push(g, say("Keeping the original plan.")));
}

export function goalPaused(g: Goal): Goal {
  // No chat line: the "Goal paused." line with the Resume button is shown instead.
  return { ...g, paused: true };
}

export function goalResumed(g: Goal): Goal {
  return reshowOpen(push({ ...g, paused: false }, say("Goal resumed.")));
}

// ---------- state transitions ----------

export function newGoal(id: string): Goal {
  return {
    id,
    planned: false,
    started: false,
    completed: [],
    ack: {},
    proofs: {},
    checkValue: "",
    achieved: false,
    messages: [],
    seq: 0,
  };
}

type MsgInput = Msg extends infer M ? (M extends Msg ? Omit<M, "id"> : never) : never;

function push(g: Goal, ...msgs: MsgInput[]): Goal {
  let seq = g.seq;
  const added = msgs.map((m) => ({ ...m, id: `${g.id}-${++seq}` }) as Msg);
  return { ...g, seq, messages: [...g.messages, ...added] };
}

const say = (text: string): MsgInput => ({ role: "assistant", kind: "text", text });

function allDone(g: Goal) {
  return g.completed.length === planOf(g).steps.length;
}

function reshowOpen(g: Goal): Goal {
  if (allDone(g)) return push(g, { role: "assistant", kind: "check" });
  return push(g, {
    role: "assistant",
    kind: "tasks",
    stepIds: availableSteps(g.completed, planOf(g)),
  });
}

export function sendText(g: Goal, raw: string, plans: Plan[] = PLANS): Goal {
  const text = raw.trim();
  if (!text) return g;
  let next = push(g, { role: "user", kind: "text", text });

  if (!next.planned) {
    const picked = planForText(text, plans);
    if (picked) return planGoal(next, picked.id, picked);
    // No template matches: a custom goal. The server takes over with intake questions.
    return next;
  }
  if (next.achieved) return push(next, say("Goal achieved."));
  if (!next.started) return push(next, say("Noted. Tap Start to begin."));

  if (allDone(next)) {
    return reshowOpen(push(next, say("I can only help with the Goal check. Back to Goal check:")));
  }
  const p = planOf(next);
  const open = availableSteps(next.completed, p)[0] ?? "";
  if (/^(done|next|skip)\b/i.test(text)) {
    const miss = missingProof(next, open);
    next = push(next, say(fitList("Not yet. Missing proof:", miss)));
    return reshowOpen(next);
  }
  next = push(
    next,
    say(`I can only help with the open step. Back to Step ${stepNumber(open, p)}:`),
  );
  return reshowOpen(next);
}

/** Records only the user's text; the server decides what the assistant says next. */
export function userText(g: Goal, raw: string): Goal {
  const text = raw.trim();
  if (!text) return g;
  return push(g, { role: "user", kind: "text", text });
}

/** Life-safety stop (see safety.ts): records the user's text and one stop-work line. Nothing else changes. */
export function safetyStop(g: Goal, raw: string, line: string): Goal {
  return push(userText(g, raw), say(line));
}

/** Case method cards. Their content lives in goal.caseData; the message only marks the place in the chat. */
export function postCaseCard(g: Goal, kind: "setup" | "approach" | "escalation"): Goal {
  return push(g, { role: "assistant", kind });
}
export function postLine(g: Goal, text: string): Goal {
  return push(g, say(text));
}

/** A line, then the open task (or Goal check) again when the goal is under way. */
export function continueWith(g: Goal, text: string): Goal {
  const next = push(g, say(text));
  return next.planned && next.started && !next.achieved ? reshowOpen(next) : next;
}
export const NEXT_GATHER_LINE = "Next: gathering evidence.";

/** Posts an intake question with quick-reply options for a custom goal. */
export function askIntake(g: Goal, question: string, options: string[]): Goal {
  return push(g, { role: "assistant", kind: "intake", question, options });
}

export const PLAN_FAILED_LINE =
  "I couldn't build a safe plan yet. Tell me more about the goal, your tools or limits, and I'll try again.";

/** The AI could not produce a valid plan twice. The user's next message is added as detail (see intakeTurn). */
export function planFailed(g: Goal): Goal {
  return push(g, say(PLAN_FAILED_LINE));
}

/** Intake label for free text that doesn't answer a pending question (e.g. after a failed plan). */
export const EXTRA_DETAIL_Q = "Additional detail from the user";

/** The last intake question still waiting for an answer, if any. Extra details don't count as answers. */
export function pendingIntakeQuestion(g: Goal): string | null {
  const asked = g.messages.filter((m) => m.kind === "intake");
  const answered = (g.intake ?? []).filter((x) => x.q !== EXTRA_DETAIL_Q).length;
  const last = asked[asked.length - 1];
  return last && last.kind === "intake" && asked.length > answered ? last.question : null;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * One user turn on an unplanned custom goal, before the text is pushed. The first user message is the
 * goal statement; later texts answer the pending intake question or, if none is pending, are kept as extra
 * detail so a retry after a failed plan really uses what the user added. Exact repeats are not stored twice.
 */
export function intakeTurn(g: Goal, raw: string): { goalText: string; intake: IntakeAnswer[] } {
  const text = raw.trim();
  const intake = [...(g.intake ?? [])];
  const first = g.messages.find((m) => m.role === "user" && m.kind === "text");
  if (!first || first.kind !== "text") return { goalText: text, intake };
  const pending = pendingIntakeQuestion(g);
  if (pending) intake.push({ q: pending, a: text });
  else if (!sameText(text, first.text) && !intake.some((x) => sameText(x.a, text)))
    intake.push({ q: EXTRA_DETAIL_Q, a: text });
  return { goalText: first.text, intake };
}

/** A side-question answer (max 2 sentences), then back to the open task. */
export function sideAnswer(g: Goal, answer: string): Goal {
  return reshowOpen(push(g, say(answer)));
}

/** An AI hint for a custom goal step, then back to the open task. */
export function stuckHint(g: Goal, hint: string): Goal {
  return reshowOpen(push(g, say(hint)));
}

/** True when the step has at least one photo proof item. */
export function hasPhotoProof(step: Step): boolean {
  return step.proof.some((it) => it.kind === "photo");
}

/** Seconds left on a step's timer; null when the step has no wait or the timer hasn't started. */
export function timerRemaining(g: Goal, stepId: string, now: number): number | null {
  const s = getStep(stepId, planOf(g));
  const started = g.timers?.[stepId];
  if (!s.waitSeconds || !started) return null;
  const end = Date.parse(started) + s.waitSeconds * 1000;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

/** A step with a wait can be submitted only after its timer has started and ended. */
export function timerBlocks(g: Goal, stepId: string, now: number): boolean {
  const s = getStep(stepId, planOf(g));
  if (!s.waitSeconds) return false;
  const left = timerRemaining(g, stepId, now);
  return left === null || left > 0;
}

/** Posted once when a step's timer ends. */
export function timerDone(g: Goal): Goal {
  return push(g, say("Timer done. Submit your proof."));
}

/** The photo check found proof items missing; re-show the open task. */
export function photoMissing(g: Goal, items: string[]): Goal {
  return reshowOpen(push(g, say(fitList("Not verified. Missing:", items))));
}

/** The photo was unclear; ask for a clearer one naming what must be visible. */
export function photoUnclear(g: Goal, visible: string): Goal {
  const item = limitWords(visible, LINE_WORDS - 5).replace(/[.…]+$/, "");
  return reshowOpen(push(g, say(`Photo unclear. Retake it showing: ${item}.`)));
}

export function planGoal(g: Goal, planId = PHONE_PLAN.id, planData?: Plan): Goal {
  if (g.planned) return g;
  const next: Goal = { ...g, planId, planned: true };
  if (planData) next.plan = planData;
  return push(next, { role: "assistant", kind: "goal" });
}

export function startGoal(g: Goal): Goal {
  if (g.started) return g;
  return push(
    { ...g, started: true },
    {
      role: "assistant",
      kind: "tasks",
      stepIds: availableSteps(g.completed, planOf(g)),
    },
  );
}

export function setProof(g: Goal, stepId: string, itemId: string, value: ProofValue): Goal {
  return {
    ...g,
    proofs: { ...g.proofs, [stepId]: { ...(g.proofs[stepId] ?? {}), [itemId]: value } },
  };
}

export function setAck(g: Goal, stepId: string, value: boolean): Goal {
  return { ...g, ack: { ...g.ack, [stepId]: value } };
}

export function submitProof(g: Goal, stepId: string, skipPhoto = false): Goal {
  const p = planOf(g);
  if (stepStatus(stepId, g.completed, p) !== "available") return g;
  if (missingProof(g, stepId, skipPhoto).length) return g;
  const before = g.completed;
  const after = [...before, stepId];
  let next = push({ ...g, completed: after }, say(`Step ${stepNumber(stepId, p)} verified.`));
  const unlocked = newlyUnlocked(before, after, p);
  if (unlocked.length) next = push(next, { role: "assistant", kind: "tasks", stepIds: unlocked });
  if (allDone(next)) next = push(next, { role: "assistant", kind: "check" });
  return next;
}

export function stuck(g: Goal, stepId: string): Goal {
  return reshowOpen(push(g, say(getStep(stepId, planOf(g)).hint)));
}

export function setCheckValue(g: Goal, v: string): Goal {
  return { ...g, checkValue: v };
}

export function setCheckProof(g: Goal, itemId: string, v: ProofValue): Goal {
  return { ...g, checkProofs: { ...(g.checkProofs ?? {}), [itemId]: v } };
}

export function submitCheck(g: Goal): Goal {
  if (!allDone(g) || g.achieved || !checkReady(g)) return g;
  const c = planOf(g).check;
  const pass =
    c.kind === "rise"
      ? goalCheckPasses(
          g.proofs[c.baseStep]?.[c.baseItem] as string | undefined,
          g.checkValue,
          c.rise,
        )
      : passFailCheckPasses(c.items, g.checkProofs ?? {});
  if (pass) {
    return push({ ...g, achieved: true }, { role: "assistant", kind: "recap" });
  }
  return push(g, { role: "assistant", kind: "checkFail" });
}

export function retryCheck(g: Goal): Goal {
  return push({ ...g, checkValue: "", checkProofs: {} }, { role: "assistant", kind: "check" });
}
