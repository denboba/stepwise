import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Loader2,
  Lock,
  ShieldAlert,
  Timer,
  Unlock,
} from "lucide-react";
import { RingTimer } from "./Progress";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import * as E from "@/lib/engine";
import type { Goal } from "@/lib/engine";
import type { Stepwise } from "@/lib/store";
import { MAX_PHOTO_BYTES } from "@/lib/limits";

const card = "rounded-2xl border bg-card p-4 shadow-card sm:p-5";
const label = "font-mono text-[11px] uppercase tracking-wider text-muted-foreground";

export function GoalCard({ goal, sw }: { goal: Goal; sw: Stepwise }) {
  const p = E.planOf(goal);
  return (
    <div className={card}>
      <div className={label}>Goal</div>
      <div className="mt-1 text-lg font-semibold">
        {p.goal.charAt(0).toUpperCase() + p.goal.slice(1)}
      </div>
      <div className={cn(label, "mt-4")}>Done means</div>
      <p className="mt-1 text-sm">{p.doneMeans}</p>
      <p className="mt-3 text-sm text-muted-foreground">
        {p.steps.length} steps plus a final Goal check.
      </p>
      {goal.started ? (
        <p className="mt-4 text-sm font-medium text-muted-foreground">Started</p>
      ) : (
        <Button className="mt-4 w-full sm:w-auto" disabled={sw.busy} onClick={sw.start}>
          Start
        </Button>
      )}
    </div>
  );
}

function DoneRow({ goal, stepId }: { goal: Goal; stepId: string }) {
  const [open, setOpen] = useState(false);
  const p = E.planOf(goal);
  const s = E.getStep(stepId, p);
  const unlocked = E.newlyUnlocked(
    goal.completed.filter((x) => x !== stepId),
    goal.completed,
    p,
  ).filter((id) => !goal.completed.includes(id));
  return (
    <div className="animate-fold space-y-2">
      <div className="rounded-2xl border bg-card/60">
        <button
          className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="grid size-5 animate-pop place-items-center rounded-full bg-success text-success-foreground">
            <Check className="size-3" aria-hidden />
          </span>
          <span className="sr-only">Done:</span>
          <span className="flex-1 truncate">
            Step {E.stepNumber(stepId, p)}, {s.title}
          </span>
          {goal.overrides?.[stepId] && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Overridden by you
            </span>
          )}
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        {open && (
          <div className="border-t px-3 py-2.5 text-sm text-muted-foreground">
            <p>{E.recapLine(goal, stepId)}</p>
            {goal.overrides?.[stepId] && (
              <p className="mt-1">Overridden by you: "{goal.overrides[stepId]}"</p>
            )}
          </div>
        )}
      </div>
      {unlocked.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs">
          <span className="text-muted-foreground">Unlocked:</span>
          {unlocked.map((id, i) => (
            <span
              key={id}
              style={{ animationDelay: `${80 * i}ms` }}
              className="inline-flex animate-pop items-center gap-1 rounded-full bg-accent px-2.5 py-1 font-medium text-accent-foreground"
            >
              <Unlock className="size-3" aria-hidden /> {E.getStep(id, p).title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ goal, stepId, sw }: { goal: Goal; stepId: string; sw: Stepwise }) {
  const p = E.planOf(goal);
  const s = E.getStep(stepId, p);
  const [whyOpen, setWhyOpen] = useState(false);
  const vals = goal.proofs[stepId] ?? {};
  const ack = !!goal.ack[stepId];
  const proofActive = !s.safety || ack;
  const now = useNow(!!s.waitSeconds);
  const timerLeft = E.timerRemaining(goal, stepId, now);
  const timerBlocked = E.timerBlocks(goal, stepId, now);
  const ready = E.missingProof(goal, stepId).length === 0 && !timerBlocked;
  const checking = sw.checking === stepId;
  const verdict = goal.verdicts?.[stepId];
  const canOverride = E.canOverride(goal, stepId);
  const overrideReady =
    E.missingProof(goal, stepId, !!goal.overrideOffered?.[stepId]).length === 0 && !timerBlocked;
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState("");

  // When the countdown reaches zero, ask the server to post "Timer done" (it posts only once).
  const posted = useRef(false);
  useEffect(() => {
    if (timerLeft === 0 && !goal.timerPosted?.[stepId] && !posted.current) {
      posted.current = true;
      void sw.timerDone(stepId);
    }
  }, [timerLeft, goal.timerPosted, stepId, sw]);

  return (
    <div
      id={`task-${stepId}`}
      data-task-step={stepId}
      className={cn(card, "scroll-mt-4 space-y-4")}
    >
      <div className="flex items-start gap-3">
        <span
          className="tabular grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
          aria-label={`Step ${E.stepNumber(stepId, p)} of ${p.steps.length}`}
        >
          {E.stepNumber(stepId, p)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-snug">{s.title}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
              <Clock className="size-3" aria-hidden /> about {s.minutes} min
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 font-medium text-primary">
              <Circle className="size-2.5" aria-hidden /> {checking ? "Checking" : "Open"}
            </span>
          </div>
        </div>
      </div>

      {s.safety && (
        <div
          className="rounded-xl border-l-4 border-warning-foreground/60 bg-warning p-3 text-sm text-warning-foreground"
          role="note"
        >
          <div className="flex gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <span className="font-semibold">Safety. </span>
              {s.safety}
            </p>
          </div>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 font-medium">
            <Checkbox checked={ack} onCheckedChange={(v) => sw.setAck(stepId, v === true)} />I
            understand
          </label>
        </div>
      )}

      <div>
        <div className={label}>Do this</div>
        <ol className="mt-2 space-y-1.5 text-sm">
          {s.actions.map((a, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="font-mono text-xs leading-5 text-primary">{i + 1}.</span>
              <span>{a}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className={cn(!proofActive && "pointer-events-none opacity-45")}>
        <div className={label}>Proof needed</div>
        {!proofActive && (
          <p className="mt-1 text-xs">Tick "I understand" on the safety note first.</p>
        )}
        <div className="mt-2 space-y-2">
          {s.proof.map((it) => {
            const v = vals[it.id];
            const set = (nv: E.ProofValue) => sw.setProof(stepId, it.id, nv);
            if (it.kind === "check")
              return (
                <label
                  key={it.id}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors duration-150",
                    v === true ? "border-primary/50 bg-accent/60" : "hover:bg-muted",
                  )}
                >
                  <Checkbox
                    disabled={!proofActive}
                    checked={v === true}
                    onCheckedChange={(c) => set(c === true)}
                  />
                  <span className="flex-1">{it.label}</span>
                  {v === true && <Check className="size-4 animate-pop text-primary" aria-hidden />}
                </label>
              );
            if (it.kind === "passfail")
              return (
                <div
                  key={it.id}
                  className={cn(
                    "flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm",
                    v === "pass" && "border-primary/50 bg-accent/60",
                    v === "fail" && "border-destructive/50",
                  )}
                >
                  <span>{it.label}</span>
                  <div className="flex gap-1.5" role="group" aria-label={it.label}>
                    {(["pass", "fail"] as const).map((o) => (
                      <Button
                        key={o}
                        size="sm"
                        aria-pressed={v === o}
                        disabled={!proofActive}
                        variant={v === o ? "default" : "outline"}
                        onClick={() => set(o)}
                        className="max-md:min-h-11 capitalize"
                      >
                        {o}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            if (it.kind === "photo")
              return (
                <PhotoInput
                  key={it.id}
                  label={it.label}
                  value={typeof v === "string" ? v : ""}
                  disabled={!proofActive || sw.busy}
                  upload={(f) => sw.uploadPhoto(stepId, it.id, f)}
                  onChange={set}
                />
              );
            return (
              <label key={it.id} className="block rounded-xl border px-3 py-2.5 text-sm">
                <span>{it.label}</span>
                <Input
                  className="mt-1.5 h-11"
                  disabled={!proofActive}
                  type={it.kind === "number" ? "number" : "text"}
                  inputMode={it.kind === "number" ? "numeric" : undefined}
                  min={it.min}
                  max={it.max}
                  value={typeof v === "string" ? v : ""}
                  onChange={(e) => set(e.target.value)}
                />
              </label>
            );
          })}
        </div>
      </div>

      {s.waitSeconds ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
          {timerLeft !== null && timerLeft > 0 ? (
            <RingTimer left={timerLeft} total={s.waitSeconds} />
          ) : (
            <Timer className="size-4 text-primary" aria-hidden />
          )}
          {timerLeft === null ? (
            <>
              <span className="flex-1">Timer: {formatTime(s.waitSeconds)}</span>
              <Button
                size="sm"
                className="max-md:min-h-11"
                variant="outline"
                disabled={sw.busy}
                onClick={() => sw.startTimer(stepId)}
              >
                Start timer
              </Button>
            </>
          ) : timerLeft > 0 ? (
            <span className="flex-1" role="timer" aria-live="off">
              <span className="sr-only">{formatTime(timerLeft)} left. </span>
              <span className="text-muted-foreground">Submit unlocks when it ends.</span>
            </span>
          ) : (
            <span className="flex-1">Timer done.</span>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          className="h-11 w-full rounded-full sm:w-auto sm:px-6"
          disabled={!ready || sw.busy}
          onClick={() => sw.submit(stepId)}
        >
          {checking ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Checking photo…
            </>
          ) : (
            "Submit proof"
          )}
        </Button>
        <Button
          variant="ghost"
          className="h-11 rounded-full"
          disabled={sw.busy}
          onClick={() => sw.stuck(stepId)}
        >
          I'm stuck
        </Button>
      </div>

      {canOverride && (
        <div className="space-y-2 text-sm">
          {!overrideOpen ? (
            <button
              className="text-xs text-muted-foreground underline max-md:min-h-11"
              onClick={() => setOverrideOpen(true)}
            >
              Photo check is wrong? Override once
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border p-3">
              <label className="block">
                <span className="text-xs text-muted-foreground">
                  Why is the photo check wrong? (one line)
                </span>
                <Input
                  className="mt-1"
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <Button
                size="sm"
                className="max-md:min-h-11"
                variant="outline"
                disabled={reason.trim().length < 3 || !overrideReady || sw.busy}
                onClick={() => sw.submit(stepId, reason.trim())}
              >
                Override and submit
              </Button>
            </div>
          )}
        </div>
      )}

      <button
        className="flex items-center gap-1 text-xs text-muted-foreground max-md:min-h-11"
        aria-expanded={whyOpen}
        onClick={() => setWhyOpen((o) => !o)}
      >
        {whyOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Why this matters
      </button>
      {whyOpen && <p className="-mt-2 text-sm text-muted-foreground">{s.why}</p>}
    </div>
  );
}

export function TaskGroup({
  goal,
  stepIds,
  sw,
  latestFor,
  msgId,
}: {
  goal: Goal;
  stepIds: string[];
  sw: Stepwise;
  latestFor: Record<string, string>;
  msgId: string;
}) {
  // Steps removed by a plan update no longer exist; older messages simply skip them.
  const plan = E.planOf(goal);
  const ids = stepIds.filter((id) => plan.steps.some((s) => s.id === id));
  if (!ids.length) return null;
  return (
    <div className="space-y-2">
      {ids.length > 1 && <div className={label}>Any order</div>}
      {ids.map((id) => {
        if (goal.completed.includes(id)) return <DoneRow key={id} goal={goal} stepId={id} />;
        if (latestFor[id] !== msgId)
          return (
            <div key={id} className="px-1 text-sm text-muted-foreground opacity-80">
              Step {E.stepNumber(id, E.planOf(goal))}, {E.getStep(id, E.planOf(goal)).title}: open
              below.
            </div>
          );
        return <TaskCard key={id} goal={goal} stepId={id} sw={sw} />;
      })}
    </div>
  );
}

export function CheckCard({ goal, sw, active }: { goal: Goal; sw: Stepwise; active: boolean }) {
  if (!active) return <div className="px-1 text-sm text-muted-foreground">Goal check.</div>;
  const p = E.planOf(goal);
  const c = p.check;
  return (
    <div className={cn(card, "space-y-3")}>
      <div className="text-base font-semibold">Goal check</div>
      <p className="text-sm text-muted-foreground">{p.doneMeans}</p>
      {c.kind === "rise" ? (
        <label className="block text-sm">
          {c.label}
          <Input
            className="mt-1"
            type="number"
            inputMode="numeric"
            value={goal.checkValue}
            onChange={(e) => sw.setCheck(e.target.value)}
          />
        </label>
      ) : (
        <div className="space-y-2.5">
          {c.items.map((it) => {
            const v = goal.checkProofs?.[it.id];
            return (
              <div
                key={it.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>{it.label}</span>
                <div className="flex gap-1.5">
                  {(["pass", "fail"] as const).map((o) => (
                    <Button
                      key={o}
                      size="sm"
                      variant={v === o ? "default" : "outline"}
                      onClick={() => sw.setCheckProof(it.id, o)}
                      className="max-md:min-h-11 capitalize"
                    >
                      {o}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Button disabled={!E.checkReady(goal) || sw.busy} onClick={sw.submitCheck}>
        Submit proof
      </Button>
    </div>
  );
}

export function CheckFail({ sw, active }: { sw: Stepwise; active: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">Goal not met yet.</p>
      {active && (
        <Button
          variant="outline"
          size="sm"
          className="max-md:min-h-11"
          disabled={sw.busy}
          onClick={sw.retry}
        >
          Retry check
        </Button>
      )}
    </div>
  );
}

export function Recap({ goal }: { goal: Goal }) {
  return (
    <div className={cn(card, "border-primary/40")}>
      <div className="flex items-center gap-2 text-lg font-semibold text-primary">
        <Check className="size-5" /> Goal achieved
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {E.planOf(goal).steps.map((s) => (
          <li key={s.id}>{E.recapLine(goal, s.id)}</li>
        ))}
      </ul>
    </div>
  );
}

/** An intake question for a custom goal: quick-reply chips, or type a free answer in the composer. */
export function IntakeCard({
  question,
  options,
  sw,
  active,
}: {
  question: string;
  options: string[];
  sw: Stepwise;
  active: boolean;
}) {
  if (!active) return <p className="text-sm">{question}</p>;
  return (
    <div className={cn(card, "space-y-3")}>
      <p className="text-sm font-medium">{question}</p>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <Button
              key={o}
              variant="outline"
              size="sm"
              className="max-md:min-h-11 rounded-full"
              disabled={sw.busy}
              onClick={() => sw.send(o)}
            >
              {o}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Plan update" card: before/after summary with Apply / Keep original plan. */
export function PatchCard({ goal, patchId, sw }: { goal: Goal; patchId: string; sw: Stepwise }) {
  const info = goal.patches?.[patchId];
  if (!info)
    return <p className="text-sm text-muted-foreground">Couldn't load this plan update.</p>;
  const { summary, status, reason } = info;
  const applying = sw.applying === patchId;
  const rows: [string, string[]][] = [
    ["Added", summary.added],
    ["Changed", summary.changed],
    ["Removed", summary.removed],
  ];
  return (
    <div className={cn(card, "space-y-3")}>
      <div className="text-base font-semibold">Plan update</div>
      {reason && <p className="text-sm text-muted-foreground">{reason}</p>}
      <div className="space-y-2">
        {rows
          .filter(([, items]) => items.length)
          .map(([title, items]) => (
            <div key={title}>
              <div className={label}>{title}</div>
              <ul className="mt-1 space-y-0.5 text-sm">
                {items.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
      </div>
      {status === "pending" ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={sw.busy} onClick={() => sw.applyPatch(patchId)}>
            {applying ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Applying…
              </>
            ) : (
              "Apply"
            )}
          </Button>
          <Button variant="outline" disabled={sw.busy} onClick={() => sw.keepPatch(patchId)}>
            Keep original plan
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {status === "applied" ? <Check className="size-4" /> : null}
          {status === "applied" ? "Applied" : "Kept original plan"}
        </p>
      )}
    </div>
  );
}

/** Shown after the replan limit: one line plus Pause goal / Try another approach. */
export function ReplanLimit({
  sw,
  active,
  lifecycle = false,
}: {
  sw: Stepwise;
  active: boolean;
  /** Lifecycle columns exist, so "Get professional help" can be recorded. */
  lifecycle?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm">This may need a professional or a different approach.</p>
      {active && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="max-md:min-h-11"
            disabled={sw.busy}
            onClick={sw.pause}
          >
            Pause goal
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="max-md:min-h-11"
            disabled={sw.busy}
            onClick={sw.anotherApproach}
          >
            Try another approach
          </Button>
          {lifecycle && (
            <Button
              variant="outline"
              size="sm"
              className="max-md:min-h-11"
              disabled={sw.busy}
              onClick={sw.escalate}
            >
              Get professional help
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function StatusIcon({ status }: { status: E.StepStatus }) {
  if (status === "done")
    return (
      <span className="grid size-5 place-items-center rounded-full bg-success text-success-foreground">
        <Check className="size-3" aria-hidden />
      </span>
    );
  if (status === "locked")
    return (
      <span className="grid size-5 place-items-center rounded-full bg-muted text-muted-foreground">
        <Lock className="size-3" />
      </span>
    );
  return <span className="size-5 rounded-full border-2 border-primary" />;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Current time, ticking every second when enabled. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

/** Photo proof: take or upload a photo into private storage. Shows empty, uploading, error and done states. */
function PhotoInput({
  label,
  value,
  disabled,
  upload,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  upload: (f: File) => Promise<string>;
  onChange: (path: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  // Show a private, short-lived link for an already uploaded photo.
  useEffect(() => {
    let alive = true;
    if (!value) {
      setPreview(null);
      return;
    }
    supabase.storage
      .from("proof-photos")
      .createSignedUrl(value, 3600)
      .then(({ data }) => alive && setPreview(data?.signedUrl ?? null));
    return () => {
      alive = false;
    };
  }, [value]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setState("error");
      setError("That file isn't a photo. Choose an image.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setState("error");
      setError("Photo is over 5 MB. Choose a smaller one.");
      return;
    }
    setState("uploading");
    try {
      onChange(await upload(file));
      setState("idle");
    } catch (e) {
      console.error(e);
      setState("error");
      setError("Upload failed. Try again.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5 text-sm",
        state === "error" && "border-destructive/60",
        value && "border-primary/50",
      )}
    >
      <span>{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={label}
        disabled={disabled || state === "uploading"}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <div className="mt-1.5 flex items-center gap-3">
        {value ? (
          preview ? (
            <img
              src={preview}
              alt={`Your photo: ${label}`}
              loading="lazy"
              className="size-16 rounded-lg border object-cover"
            />
          ) : (
            <div className="size-16 animate-pulse rounded-lg bg-muted" aria-label="Loading photo" />
          )
        ) : null}
        <Button
          type="button"
          size="sm"
          className="max-md:min-h-11"
          variant="outline"
          disabled={disabled || state === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {state === "uploading" ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Uploading…
            </>
          ) : (
            <>
              <Camera className="size-4" /> {value ? "Replace photo" : "Take or upload photo"}
            </>
          )}
        </Button>
      </div>
      {state === "error" && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">Photos are private to you.</p>
    </div>
  );
}
