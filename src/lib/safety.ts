// Deterministic life-safety gate (spec R6). Runs on every typed message before any AI call.
// Code rules only: the model can't suppress it, and nothing here marks work done or changes the plan.
import { detectRedFlag, type Escalation } from "./casefw";
import { safetyStop, type Goal } from "./engine";

/** The life-safety red flag in the text, using code-defined patterns only (no AI flags). */
export function stopWork(text: string): Escalation | null {
  const flag = detectRedFlag(text);
  return flag?.life_safety ? flag : null;
}

/** The one line shown instead of an AI reply. */
export function stopWorkLine(flag: Escalation): string {
  return `Safety first: ${flag.sign}. ${flag.action} I'm here when you're safe.`;
}

/**
 * The goal after a typed message that hits a life-safety flag, or null when the message may continue to
 * the normal (possibly AI) path. Applies to every goal state: intake, template or custom, paused or active.
 */
export function gateText(g: Goal, text: string): { goal: Goal; sign: string } | null {
  const flag = stopWork(text);
  return flag ? { goal: safetyStop(g, text, stopWorkLine(flag)), sign: flag.sign } : null;
}
