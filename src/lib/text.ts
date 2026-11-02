/** Word limits for AI text shown in the chat. */
export const HINT_WORDS = 25;
export const SIDE_ANSWER_WORDS = 25;
export const INTAKE_QUESTION_WORDS = 15;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

export function wordCount(s: string): number {
  return words(s).length;
}

/**
 * Caps text at `max` words (counted by whitespace). Keeps whole sentences when it can: trims at the last
 * complete sentence within the limit; if the first sentence alone is too long, cuts at the limit and adds "…".
 */
export function limitWords(text: string, max: number): string {
  const all = words(text);
  if (all.length <= max) return all.join(" ");
  const head = all.slice(0, max);
  for (let i = head.length - 1; i >= 0; i--) {
    if (/[.!?]["')\]]?$/.test(head[i]!)) return head.slice(0, i + 1).join(" ");
  }
  return `${head.join(" ").replace(/[,;:\-–—]+$/, "")}…`;
}
