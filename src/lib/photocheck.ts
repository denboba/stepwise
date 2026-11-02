// Pure helpers for the AI photo check: build the prompt with untrusted data fenced off,
// and validate the AI's output in code. Anything that doesn't validate counts as "unclear".
import type { Step } from "./plan";

export interface PhotoCheckResult {
  verdict: "verified" | "missing" | "unclear";
  missing_items: string[];
  reason: string;
}

/** Longest typed value sent to the checker; the rest is cut. */
export const MAX_USER_VALUE_CHARS = 300;

/** Escapes text so it can't close or open tags inside <user_data>. */
export function escapeUserData(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The only text the checker sees: the step's photo proof labels (what to judge) and the user's typed values
 * as escaped data. No goal text, step title or other free text.
 */
export function buildPhotoCheckText(step: Step, values: Record<string, unknown>): string {
  const photo = step.proof.filter((p) => p.kind === "photo");
  const typed = step.proof
    .filter((p) => p.kind !== "photo" && values[p.id] !== undefined && values[p.id] !== "")
    .map((p) => {
      const v = String(values[p.id]).slice(0, MAX_USER_VALUE_CHARS);
      return `${escapeUserData(p.label)}: ${escapeUserData(v)}`;
    });
  return [
    "Proof labels to judge from the photo(s):",
    ...photo.map((p) => `- ${p.label}`),
    "<user_data>",
    ...(typed.length ? typed : ["(none)"]),
    "</user_data>",
  ].join("\n");
}

const UNCLEAR: PhotoCheckResult = {
  verdict: "unclear",
  missing_items: [],
  reason: "",
};

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Validates the checker's raw output. Must be {verdict, missing_items, reason}; missing_items must be a subset
 * of the step's photo proof labels; reason at most 20 words. Anything else is "unclear".
 */
export function parsePhotoVerdict(raw: unknown, labels: string[]): PhotoCheckResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return UNCLEAR;
  const r = raw as { verdict?: unknown; missing_items?: unknown; reason?: unknown };
  if (r.verdict !== "verified" && r.verdict !== "missing" && r.verdict !== "unclear")
    return UNCLEAR;
  if (!Array.isArray(r.missing_items) || typeof r.reason !== "string") return UNCLEAR;
  const reason = r.reason.trim();
  if (reason.split(/\s+/).filter(Boolean).length > 20) return UNCLEAR;
  const allowed = new Map(labels.map((l) => [norm(l), l]));
  const missing: string[] = [];
  for (const m of r.missing_items) {
    if (typeof m !== "string" || !allowed.has(norm(m))) return UNCLEAR;
    missing.push(allowed.get(norm(m))!);
  }
  if (r.verdict === "missing" && missing.length === 0) return UNCLEAR;
  if (r.verdict === "verified" && missing.length > 0) return UNCLEAR;
  return { verdict: r.verdict, missing_items: missing, reason };
}

/** Parses the checker's text reply; malformed JSON is "unclear". */
export function parsePhotoReply(text: string, labels: string[]): PhotoCheckResult {
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    return parsePhotoVerdict(JSON.parse(cleaned), labels);
  } catch {
    return UNCLEAR;
  }
}
