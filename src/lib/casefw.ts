// Case method, part 1: FRAME and the Expert Brief. Pure functions; dedicated regression tests should be added before further integration.
// The AI proposes; this code validates every field, can raise the risk tier (never lower it),
// and detects red flags with its own patterns on top of the AI's classification.

export type GoalType = "fix" | "build" | "learn" | "decide" | "organize";
export type CaseSize = "quick" | "standard" | "deep";
export type Tier = 1 | 2 | 3;
export type EvidenceType =
  | "command_output"
  | "measurement"
  | "photo"
  | "observation"
  | "document"
  | "timed_test"
  | "swap_test"
  | "link";

export interface SetupField {
  id: string;
  label: string;
  type: "chips" | "text" | "number";
  options: string[];
}
export interface RedFlag {
  sign: string;
  life_safety: boolean;
  action: string;
  /** True when the sign is already described by the user (not just something to watch for). */
  present: boolean;
}
export interface Frame {
  goal_type: GoalType;
  domain: string;
  subdomain: string;
  case_size: CaseSize;
  risk_tier: Tier;
  success_criteria: string[];
  setup_fields: SetupField[];
  known: Record<string, string>;
  red_flags: RedFlag[];
  refer_to: string;
  /** Set by code when the safety net raised the tier. */
  tier_raised_by?: string;
}
export interface EvidenceRequest {
  id: string;
  type: EvidenceType;
  title: string;
  why: string;
  instructions: string;
  expected_format: string;
  validation: { [key: string]: JsonValue };
  required: boolean;
}
export interface Brief {
  expert_role: string;
  approach: string;
  evidence_requests: EvidenceRequest[];
  rule_out: string[];
  source: "ai" | "playbook";
  needs_research: boolean;
}
export interface Escalation {
  sign: string;
  action: string;
  life_safety: boolean;
  cleared?: boolean;
}
export interface CaseData {
  frame: Frame;
  setup?: Record<string, string>;
  brief?: Brief;
  escalation?: Escalation;
}

/** JSON-safe value (case data is stored as jsonb and returned through server functions). */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Raw AI output before validation: the known fields of T, each still unchecked. */
type Unchecked<T> = { [K in keyof T]?: unknown };

export const GOAL_TYPES: GoalType[] = ["fix", "build", "learn", "decide", "organize"];
export const CASE_SIZES: CaseSize[] = ["quick", "standard", "deep"];
export const EVIDENCE_TYPES: EvidenceType[] = [
  "command_output",
  "measurement",
  "photo",
  "observation",
  "document",
  "timed_test",
  "swap_test",
  "link",
];
export const EVIDENCE_LIMIT: Record<CaseSize, number> = { quick: 1, standard: 3, deep: 6 };
export const TIER_LABEL: Record<Tier, string> = {
  1: "Low stakes",
  2: "Careful: backups first",
  3: "Prepare for a professional",
};
export const DONT_KNOW = "I don't know";

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s: string) => s.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim()).length;
const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const SAFE_ID = /^[a-z0-9_-]{1,40}$/i;

// ---------------------------------------------------------------- FRAME validation

/** Returns the list of problems; empty means the frame is valid. */
export function validateFrame(raw: unknown): string[] {
  const e: string[] = [];
  if (!raw || typeof raw !== "object") return ["Frame is not an object."];
  const f = raw as Unchecked<Frame>;
  if (!GOAL_TYPES.includes(f.goal_type as GoalType)) e.push("goal_type is invalid.");
  if (!str(f.domain) || words(f.domain) > 3) e.push("domain must be 1 to 3 words.");
  if (!str(f.subdomain) || words(f.subdomain) > 4) e.push("subdomain must be 1 to 4 words.");
  if (!CASE_SIZES.includes(f.case_size as CaseSize)) e.push("case_size is invalid.");
  if (![1, 2, 3].includes(f.risk_tier as number)) e.push("risk_tier must be 1, 2 or 3.");
  const sc = f.success_criteria;
  if (!Array.isArray(sc) || sc.length < 1 || sc.length > 3)
    e.push("success_criteria needs 1 to 3 items.");
  else
    sc.forEach(
      (c, i) =>
        (!str(c) || words(c) > 15) && e.push(`success_criteria ${i + 1} must be 1 to 15 words.`),
    );
  const sf = f.setup_fields;
  const ids = new Set<string>();
  if (!Array.isArray(sf) || sf.length > 5) e.push("setup_fields must have at most 5 items.");
  else
    sf.forEach((x, i) => {
      const s = (x ?? {}) as Unchecked<SetupField>;
      const n = `setup_fields ${i + 1}`;
      if (!str(s.id) || !SAFE_ID.test(s.id) || ids.has(s.id))
        e.push(`${n} needs a unique simple id.`);
      else ids.add(s.id);
      if (!str(s.label) || words(s.label) > 6) e.push(`${n} label must be 1 to 6 words.`);
      if (!["chips", "text", "number"].includes(s.type as string)) e.push(`${n} type is invalid.`);
      if (s.type === "chips") {
        const o = s.options;
        if (
          !Array.isArray(o) ||
          o.length < 2 ||
          o.length > 6 ||
          !o.every((v) => str(v) && words(v) <= 5)
        )
          e.push(`${n} needs 2 to 6 short options.`);
      }
    });
  if (
    f.known !== undefined &&
    (typeof f.known !== "object" || f.known === null || Array.isArray(f.known))
  )
    e.push("known must be an object.");
  const rf = f.red_flags;
  if (!Array.isArray(rf) || rf.length > 5) e.push("red_flags must have at most 5 items.");
  else
    rf.forEach((x, i) => {
      const r = (x ?? {}) as Unchecked<RedFlag>;
      if (!str(r.sign) || words(r.sign) > 12)
        e.push(`red_flags ${i + 1} sign must be 1 to 12 words.`);
      if (typeof r.life_safety !== "boolean")
        e.push(`red_flags ${i + 1} life_safety must be true or false.`);
      if (!str(r.action) || words(r.action) > 15)
        e.push(`red_flags ${i + 1} action must be 1 to 15 words.`);
    });
  if (!str(f.refer_to) || words(f.refer_to) > 8) e.push("refer_to must be 1 to 8 words.");
  return e;
}

/** Normalizes a validated frame (drops unknown keys, keeps only known answers for real fields). */
export function toFrame(raw: unknown): Frame {
  const f = raw as Frame;
  const setup_fields: SetupField[] = f.setup_fields.map((s) => ({
    id: String(s.id),
    label: String(s.label).trim(),
    type: s.type,
    options: s.type === "chips" ? (s.options as string[]).map((o) => o.trim()) : [],
  }));
  const known: Record<string, string> = {};
  for (const [k, v] of Object.entries((f.known ?? {}) as Record<string, unknown>))
    if (
      setup_fields.some((s) => s.id === k) &&
      (typeof v === "string" || typeof v === "number") &&
      String(v).trim()
    )
      known[k] = String(v).trim().slice(0, 200);
  return {
    goal_type: f.goal_type,
    domain: String(f.domain).trim(),
    subdomain: String(f.subdomain).trim(),
    case_size: f.case_size,
    risk_tier: f.risk_tier,
    success_criteria: (f.success_criteria as string[]).map((s) => s.trim()),
    setup_fields,
    known,
    red_flags: f.red_flags.map((r) => ({
      sign: String(r.sign).trim(),
      life_safety: !!r.life_safety,
      action: String(r.action).trim(),
      present: r.present === true,
    })),
    refer_to: String(f.refer_to).trim(),
  };
}

// ---------------------------------------------------------------- Tier safety net
// Phrase and context rules instead of bare keywords: a rule fires on a specific phrase, or when a
// subject word and a context word appear in the same sentence. This keeps "socket wrench" or
// "my code has a child process" from raising the tier, while "replace a wall socket" does.

interface RiskRule {
  id: string;
  tier: 2 | 3;
  /** Any one phrase matches. */
  phrases?: RegExp[];
  /** Or: a subject word AND a context word in the same sentence. */
  subject?: RegExp;
  context?: RegExp;
}

export const RISK_RULES: RiskRule[] = [
  {
    id: "health symptom",
    tier: 3,
    phrases: [
      /\b(chest|heart) (pain|hurts?|aches?|tight(ness)?|pressure)\b/,
      /\bchest hurts\b/,
      /\b(short(ness)? of breath|can'?t breathe|trouble breathing|breathless)\b/,
      /\b(faint(ed|ing)?|passed out|blacked out|seizures?|stroke|numbness)\b/,
      /\b(bleeding|vomiting blood|coughing blood|blood in (my )?(stool|urine))\b/,
      /\b(pregnan(t|cy)|miscarriage)\b/,
      /\b(lump|rash|fever|infection|migraine|dizz(y|iness))\b/,
    ],
    subject: /\b(pain|hurts?|aches?|sore|swollen|symptoms?)\b/,
    context:
      /\b(chest|head|stomach|back|arm|leg|knee|joint|throat|eye|ear|tooth|when i (run|walk|eat|breathe))\b/,
  },
  {
    id: "medication",
    tier: 3,
    phrases: [
      /\b(medication|medicine|prescription|dosage|dose|overdose|antibiotics?|painkillers?|ibuprofen|paracetamol|insulin)\b/,
    ],
    subject: /\b(pills?|tablets?|drugs?)\b/,
    context: /\b(take|taking|how many|mg|daily|mix|stop)\b/,
  },
  {
    id: "mental health crisis",
    tier: 3,
    phrases: [
      /\b(suicid(e|al)|kill myself|end (my|it all)|self[- ]harm|hurt(ing)? myself|don'?t want to live)\b/,
    ],
  },
  {
    id: "legal",
    tier: 3,
    phrases: [
      /\b(lawsuit|sue|sued|suing|court|lawyer|attorney|eviction|evicted|custody|divorce|arrest(ed)?|criminal|immigration|visa (refus|denied))\w*/,
    ],
    subject: /\b(contract|lease|landlord|employer|fine|ticket)\b/,
    context: /\b(dispute|break|breach|legal|rights|fight|appeal|threat)\w*/,
  },
  {
    id: "tax or investment",
    tier: 3,
    phrases: [/\b(tax return|tax bill|audit(ed)?|irs|hmrc|tax (advice|owed|debt))\b/],
    subject: /\b(invest\w*|stocks?|shares|crypto\w*|pension|retirement|etf|portfolio)\b/,
    context: /\b(should|which|buy|sell|put|move|best|advice|recommend)\b/,
  },
  {
    id: "mains electricity",
    tier: 3,
    phrases: [
      /\b(mains|rewir\w*|fuse box|consumer unit|breaker panel|live wire|230 ?v|240 ?v|120 ?v)\b/,
    ],
    subject: /\b(wiring|outlet|socket|light switch|light fixture|ceiling light|breaker|circuit)\b/,
    context: /\b(install|replace|wire|fix|change|add|move|repair|spark|burn|smok|shock)\w*/,
  },
  {
    id: "gas",
    tier: 3,
    phrases: [
      /\b(gas (leak|smell|line|pipe|stove|cooker|hob|meter)|smell(s)? (of )?gas|carbon monoxide|co alarm|boiler|furnace|water heater)\b/,
    ],
  },
  {
    id: "structural",
    tier: 3,
    phrases: [
      /\b(load[- ]bearing|structural|foundation|joists?|remove (a|the) wall|crack(s|ed)? in (the )?(wall|ceiling|foundation)|sagging (ceiling|roof|floor))\b/,
    ],
  },
  {
    id: "vehicle critical",
    tier: 3,
    phrases: [
      /\b(brakes?|brake (pads?|fluid|lines?)|steering|airbags?|tyre blowout|tire blowout|suspension)\b/,
    ],
  },
  {
    id: "child or personal safety",
    tier: 3,
    phrases: [
      /\b(car seat|child ?proof\w*|baby (fell|swallowed|choking)|toddler (fell|swallowed)|abuse|stalk\w*|domestic violence|being followed|threatened)\b/,
    ],
    subject: /\b(child|children|kid|kids|baby|toddler|infant)\b/,
    context: /\b(safe|safety|hurt|injur|swallow|fell|fall|choke|choking|danger|missing)\w*/,
  },
  {
    id: "weapons",
    tier: 3,
    phrases: [/\b(guns?|firearms?|ammunition|ammo|explosives?|bombs?)\b/],
  },
  {
    id: "data or devices",
    tier: 2,
    phrases: [
      /\b(hard drive|ssd|backup|back up|data loss|lost (my )?files|factory reset|reinstall\w*|bios|firmware)\b/,
    ],
    subject: /\b(laptop|computer|pc|mac|phone|tablet|router|printer|account|disk|drive)\b/,
    context:
      /\b(slow|broken|crash\w*|won'?t|not working|fix|repair|error|virus|hacked|locked|freez\w*)\b/,
  },
  {
    id: "money or accounts",
    tier: 2,
    phrases: [/\b(bank account|budget\w*|debt|savings|credit card|loan|mortgage|refund|invoice)\b/],
  },
  {
    id: "home repair",
    tier: 2,
    phrases: [
      /\b(water leak|leak(ing|y)? (pipe|tap|faucet|roof)|plumbing|drill(ing)? into|mould|mold|damp)\b/,
    ],
    subject:
      /\b(appliance|washing machine|dishwasher|fridge|oven|heater|tap|faucet|toilet|door|window)\b/,
    context: /\b(fix|repair|broken|leak\w*|won'?t|not working|replace)\b/,
  },
];

function sentencesOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[.!?\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Every rule that matches the text, highest tier first. */
export function riskMatches(text: string): { id: string; tier: 2 | 3 }[] {
  const out: { id: string; tier: 2 | 3 }[] = [];
  const parts = sentencesOf(text);
  for (const r of RISK_RULES) {
    const hit = parts.some(
      (s) =>
        r.phrases?.some((p) => p.test(s)) ||
        (r.subject && r.context && r.subject.test(s) && r.context.test(s)),
    );
    if (hit) out.push({ id: r.id, tier: r.tier });
  }
  return out.sort((a, b) => b.tier - a.tier);
}

/** Raises the AI's tier when the text matches a higher rule. Never lowers it. */
export function applyTierNet(frame: Frame, text: string): Frame {
  const top = riskMatches(text)[0];
  if (!top || top.tier <= frame.risk_tier) return frame;
  return { ...frame, risk_tier: top.tier, tier_raised_by: top.id };
}

// ---------------------------------------------------------------- Red flags

/** Code-side life-safety signs. They always win over the AI. */
const LIFE_SAFETY: { sign: string; re: RegExp; action: string }[] = [
  {
    sign: "Chest pain with breathing trouble or fainting",
    re: /\b(chest (pain|hurts?|tight\w*|pressure)|chest hurts)\b[^.]*\b(breath|faint|sweat|arm|jaw|dizz)\w*|\b(can'?t breathe|struggling to breathe)\b/,
    action: "Stop now and get urgent medical help.",
  },
  {
    sign: "Thoughts of suicide or self-harm",
    re: /\b(suicid(e|al)|kill myself|end my life|self[- ]harm|hurt(ing)? myself|don'?t want to live)\b/,
    action: "Reach a crisis line or someone you trust right now.",
  },
  {
    sign: "Smell of gas or a carbon monoxide alarm",
    // An alarm going off, a leak or poisoning; installing a detector or alarm is ordinary safety work.
    re: /\b(smell(s|ing)? (of )?gas|gas (leak|smell)|carbon monoxide (leak|poisoning)|(co|carbon monoxide) (alarm|detector) (is |keeps |has been )?(going off|went off|sounding|beeping|ringing))\b/,
    action: "Leave the building, don't touch switches, call emergency services.",
  },
  {
    sign: "Fire, smoke or sparks",
    re: /\b(on fire|caught fire|smok(e|ing) (from|coming)|sparks? (from|coming)|burning smell from (the )?(outlet|socket|wall))\b/,
    action: "Unplug only if safe, leave, and call emergency services.",
  },
  {
    sign: "Heavy bleeding, seizure or unconsciousness",
    re: /\b(won'?t stop bleeding|bleeding heavily|seizure|unconscious|not breathing|overdos\w*|swallowed (a )?(battery|magnet|poison|bleach))\b/,
    action: "Call emergency services now.",
  },
];

/** Code check first; then any AI red flag marked as present. */
export function detectRedFlag(text: string, aiFlags: RedFlag[] = []): Escalation | null {
  const t = sentencesOf(text).join(". ");
  for (const f of LIFE_SAFETY)
    if (f.re.test(t)) return { sign: f.sign, action: f.action, life_safety: true };
  const present = aiFlags.filter((f) => f.present);
  const pick = present.find((f) => f.life_safety) ?? present[0];
  return pick ? { sign: pick.sign, action: pick.action, life_safety: pick.life_safety } : null;
}

// ---------------------------------------------------------------- Setup card

/** Fields still to ask: those not already answered by the goal text. */
export function openSetupFields(frame: Frame): SetupField[] {
  return frame.setup_fields.filter((f) => !(f.id in frame.known));
}

/** Keeps answers only for real, open fields; "I don't know" is always allowed. */
export function cleanSetupAnswers(
  frame: Frame,
  answers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...frame.known };
  for (const f of openSetupFields(frame)) {
    const v = String(answers[f.id] ?? "")
      .trim()
      .slice(0, 200);
    if (!v) out[f.id] = DONT_KNOW;
    else if (f.type === "number" && v !== DONT_KNOW && !Number.isFinite(Number(v)))
      out[f.id] = DONT_KNOW;
    else out[f.id] = v;
  }
  return out;
}

// ---------------------------------------------------------------- BRIEF validation

/** Action, diagnosis, dose, legal-strategy and financial-advice language not allowed in tier-3 briefs. */
const TIER3_FORBIDDEN: RegExp[] = [
  /\b(take|swallow|apply|inject|stop taking|increase|decrease)\b[^.]*\b(mg|ml|pills?|tablets?|dose|medication|medicine)\b/,
  /\b\d+\s?(mg|ml|mcg|iu)\b/,
  /\b(you (likely|probably|may) have|diagnos\w*|it is (probably|likely) (a|an))\b/,
  /\b(file|sue|plead|countersue|withhold rent|ignore the (notice|letter)|sign the)\b/,
  /\b(buy|sell|invest in|move your money|put your savings)\b/,
  /\b(open|remove|replace|disconnect|rewire|turn off the gas|unscrew|drill|cut|repair|fix|adjust|bleed)\b/,
];

export function validateBrief(raw: unknown, frame: Frame): string[] {
  const e: string[] = [];
  if (!raw || typeof raw !== "object") return ["Brief is not an object."];
  const b = raw as Unchecked<Brief>;
  if (!str(b.expert_role) || words(b.expert_role) > 6) e.push("expert_role must be 1 to 6 words.");
  if (!str(b.approach) || words(b.approach) > 25) e.push("approach must be 1 to 25 words.");
  if (b.source !== "ai") e.push('source must be "ai".');
  if (typeof b.needs_research !== "boolean") e.push("needs_research must be true or false.");
  const ro = b.rule_out;
  if (!Array.isArray(ro) || ro.length > 3 || !ro.every((x) => str(x) && words(x) <= 12))
    e.push("rule_out must have at most 3 short items.");
  const reqs = b.evidence_requests;
  const max = EVIDENCE_LIMIT[frame.case_size];
  if (!Array.isArray(reqs)) return [...e, "evidence_requests must be a list."];
  if (reqs.length > max)
    e.push(`A ${frame.case_size} case allows at most ${max} evidence requests.`);
  if (frame.case_size !== "quick" && reqs.length < 1) e.push("Add at least 1 evidence request.");
  const ids = new Set<string>();
  reqs.forEach((x, i) => {
    const r = (x ?? {}) as Unchecked<EvidenceRequest>;
    const n = `evidence_requests ${i + 1}`;
    if (!str(r.id) || !SAFE_ID.test(r.id) || ids.has(r.id))
      e.push(`${n} needs a unique simple id.`);
    else ids.add(r.id);
    if (!EVIDENCE_TYPES.includes(r.type as EvidenceType)) e.push(`${n} type is invalid.`);
    if (!str(r.title) || words(r.title) > 10) e.push(`${n} title must be 1 to 10 words.`);
    if (!str(r.why) || words(r.why) > 12) e.push(`${n} why must be 1 to 12 words.`);
    if (!str(r.instructions) || sentences(r.instructions) > 3)
      e.push(`${n} instructions must be 1 to 3 sentences.`);
    if (!str(r.expected_format)) e.push(`${n} needs expected_format.`);
    if (!r.validation || typeof r.validation !== "object" || Array.isArray(r.validation))
      e.push(`${n} validation must be an object.`);
    if (typeof r.required !== "boolean") e.push(`${n} required must be true or false.`);
    if (frame.risk_tier === 3) {
      if (r.type !== "observation" && r.type !== "document")
        e.push(`${n}: tier 3 allows only observation and document evidence.`);
      const text = `${r.title ?? ""}. ${r.instructions ?? ""}`.toLowerCase();
      if (TIER3_FORBIDDEN.some((p) => p.test(text)))
        e.push(
          `${n}: tier 3 must only organize the user's own facts, never actions, diagnoses, doses or advice.`,
        );
    }
  });
  if (
    frame.risk_tier === 3 &&
    TIER3_FORBIDDEN.some((p) => p.test(String(b.approach ?? "").toLowerCase()))
  )
    e.push("approach: tier 3 must only prepare the user for a professional.");
  return e;
}

/** Normalizes a validated brief. Photo evidence is always optional. */
export function toBrief(raw: unknown): Brief {
  const b = raw as Brief;
  return {
    expert_role: String(b.expert_role).trim(),
    approach: String(b.approach).trim(),
    evidence_requests: b.evidence_requests.map((r) => ({
      id: String(r.id),
      type: r.type,
      title: String(r.title).trim(),
      why: String(r.why).trim(),
      instructions: String(r.instructions).trim(),
      expected_format: String(r.expected_format).trim(),
      validation: r.validation,
      required: r.type === "photo" ? false : !!r.required,
    })),
    rule_out: (b.rule_out as string[]).map((s) => s.trim()),
    source: "ai",
    needs_research: !!b.needs_research,
  };
}

/** Text the setup answers add to the case, used for red-flag and tier checks. */
export function setupText(frame: Frame, answers: Record<string, string>): string {
  return frame.setup_fields
    .map((f) =>
      answers[f.id] && answers[f.id] !== DONT_KNOW ? `${f.label}: ${answers[f.id]}` : "",
    )
    .filter(Boolean)
    .join(". ");
}
