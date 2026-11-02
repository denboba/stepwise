import { useEffect, useState } from "react";
import { Check, ChevronDown, Circle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityEvent, ActivityStatus } from "@/lib/activity";
import { workedFor } from "@/lib/activity";
import { PHASE_ACTIVE, PHASE_LABEL, type Phase } from "@/lib/phase";

/** Small progress ring with "2 of 5" beside it. */
export function ProgressRing({
  done,
  total,
  size = 28,
  label = true,
}: {
  done: number;
  total: number;
  size?: number;
  label?: boolean;
}) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <span className="inline-flex items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={3}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="stroke-primary transition-[stroke-dashoffset] duration-200 ease-out"
        />
      </svg>
      {label && (
        <span className="tabular text-xs font-medium text-muted-foreground">
          {done} of {total}
        </span>
      )}
    </span>
  );
}

/** Segmented tracker: Understand · (Research) · Plan · Do · Check. */
export function PhaseTracker({ list, current }: { list: Phase[]; current: Phase | null }) {
  const idx = current ? list.indexOf(current) : list.length;
  return (
    <ol className="flex items-center gap-1" aria-label="Progress">
      {list.map((p, i) => {
        const state = i < idx ? "done" : i === idx ? "current" : "upcoming";
        return (
          <li key={p} className="flex items-center gap-1">
            {i > 0 && (
              <span
                aria-hidden
                className={cn("h-px w-3 sm:w-5", i <= idx ? "bg-primary/60" : "bg-border")}
              />
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs transition-colors duration-200",
                state === "current" && "bg-accent font-medium text-accent-foreground",
                state === "done" && "text-foreground",
                state === "upcoming" && "text-muted-foreground",
              )}
              aria-current={state === "current" ? "step" : undefined}
            >
              {state === "done" ? (
                <Check className="size-3 text-primary" aria-hidden />
              ) : state === "current" ? (
                <span aria-hidden className="size-2 animate-phase rounded-full bg-primary" />
              ) : (
                <span
                  aria-hidden
                  className="size-2 rounded-full border border-muted-foreground/60"
                />
              )}
              {PHASE_LABEL[p]}
              <span className="sr-only">
                {state === "done" ? ", finished" : state === "current" ? ", current" : ", upcoming"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Phone version: one pill, "Planning · 2 of 4". */
export function PhasePill({
  current,
  done,
  total,
  onClick,
  expanded,
}: {
  current: Phase | null;
  done: number;
  total: number;
  onClick: () => void;
  expanded: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={`${current ? PHASE_ACTIVE[current] : "Goal met"}, ${done} of ${total} steps. Open plan`}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-accent px-3 text-xs font-medium text-accent-foreground"
    >
      {current ? (
        <span aria-hidden className="size-2 animate-phase rounded-full bg-primary" />
      ) : (
        <Check className="size-3.5" aria-hidden />
      )}
      <span className="tabular">
        {current ? PHASE_ACTIVE[current] : "Goal met"} · {done} of {total}
      </span>
    </button>
  );
}

export function ActivityIcon({ status }: { status: ActivityStatus }) {
  if (status === "running")
    return <Loader2 className="size-4 animate-spin text-primary" aria-hidden />;
  if (status === "done") return <Check className="size-4 text-success" aria-hidden />;
  if (status === "failed") return <X className="size-4 text-destructive" aria-hidden />;
  return <Circle className="size-2.5 fill-muted-foreground text-muted-foreground" aria-hidden />;
}
const STATUS_WORD: Record<ActivityStatus, string> = {
  running: "In progress",
  done: "Done",
  failed: "Failed",
  waiting: "Waiting",
};

function useTick(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function Lines({ events, now }: { events: ActivityEvent[]; now: number }) {
  return (
    <ul className="space-y-1.5">
      {events.map((e) => (
        <li key={e.id} className="flex items-center gap-2.5 text-sm">
          <ActivityIcon status={e.status} />
          <span className="sr-only">{STATUS_WORD[e.status]}:</span>
          <span className={cn("flex-1", e.status === "done" && "text-muted-foreground")}>
            {e.label}
            {e.detail ? ` ${e.detail}` : ""}
          </span>
          {e.status === "running" && (
            <span className="tabular text-xs text-muted-foreground" aria-hidden>
              {Math.max(0, Math.floor((now - e.startedAt) / 1000))}s
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The card shown while the agent works. Not announced tick by tick. */
export function LiveActivity({ events }: { events: ActivityEvent[] }) {
  const now = useTick(true);
  return (
    <div className="animate-rise rounded-2xl border bg-card p-3 shadow-card" aria-live="off">
      <Lines events={events} now={now} />
      {/* Planned: source chips and thumbnails appear here once research exists. */}
    </div>
  );
}

/** A saved activity record: collapsed to "Worked for 12s · 4 steps", expands on tap. */
export function ActivityCard({ events }: { events: ActivityEvent[] }) {
  const [open, setOpen] = useState(false);
  if (!events.length) return null;
  const failed = events.some((e) => e.status === "failed");
  return (
    <div className="rounded-2xl border bg-card/60">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs text-muted-foreground"
      >
        <ActivityIcon status={failed ? "failed" : "done"} />
        <span className="tabular flex-1">
          Worked for {workedFor(events)}s · {events.length} {events.length === 1 ? "step" : "steps"}
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <div className="animate-fold border-t px-3 py-2.5">
          <Lines events={events} now={Date.now()} />
        </div>
      )}
    </div>
  );
}

/** Ring countdown for timed steps. */
export function RingTimer({ left, total }: { left: number; total: number }) {
  const size = 56;
  const r = 24;
  const c = 2 * Math.PI * r;
  const pct = total ? left / total : 0;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return (
    <span className="relative inline-grid size-14 shrink-0 place-items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute -rotate-90"
        aria-hidden
      >
        <circle cx={28} cy={28} r={r} fill="none" strokeWidth={4} className="stroke-muted" />
        <circle
          cx={28}
          cy={28}
          r={r}
          fill="none"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="stroke-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span className="tabular text-xs font-semibold">
        {m}:{String(s).padStart(2, "0")}
      </span>
    </span>
  );
}
