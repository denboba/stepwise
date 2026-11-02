import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  ChevronDown,
  CreditCard,
  Loader2,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import * as E from "@/lib/engine";
import type { Goal } from "@/lib/engine";
import { SUGGESTIONS } from "@/lib/plan";
import { useStepwise, type Stepwise } from "@/lib/store";
import { STATUS_LABEL } from "@/lib/lifecycle";
import { EndGoalButton, LifecycleBanner, StatusChip } from "./Lifecycle";
import { PlanMap } from "./PlanMap";
import { ActivityCard, LiveActivity, PhasePill, PhaseTracker, ProgressRing } from "./Progress";
import { PHASE_ACTIVE, derivePhase, groupSteps, phases, type Group } from "@/lib/phase";
import {
  CheckCard,
  CheckFail,
  GoalCard,
  IntakeCard,
  PatchCard,
  Recap,
  ReplanLimit,
  StatusIcon,
  TaskGroup,
} from "./Cards";

function GoalList({ sw, onPick }: { sw: Stepwise; onPick?: () => void }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    localStorage.removeItem("stepwise-active-goal");
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Button
        variant="outline"
        className="justify-start gap-2"
        disabled={sw.busy}
        onClick={() => {
          sw.newGoal();
          onPick?.();
        }}
      >
        <Plus className="size-4" /> New goal
      </Button>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {sw.goalsLoading && (
          <div className="space-y-2 px-1" aria-busy="true">
            <span className="sr-only">Loading your goals…</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="shimmer h-9 rounded-lg" />
            ))}
          </div>
        )}
        {sw.goalsError && (
          <div className="px-3 py-2 text-sm">
            <p>Couldn't load your goals.</p>
            <Button variant="link" className="h-auto p-0" onClick={() => sw.retryGoals()}>
              Try again
            </Button>
          </div>
        )}
        {!sw.goalsLoading && !sw.goalsError && sw.goals.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">No goals yet.</p>
        )}
        {sw.goals.map((g) => (
          <div
            key={g.id}
            className={cn(
              "group flex items-center rounded-lg hover:bg-sidebar-accent",
              sw.activeId === g.id && "bg-sidebar-accent font-medium",
            )}
          >
            <button
              onClick={() => {
                sw.select(g.id);
                onPick?.();
              }}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-sm"
            >
              <span className="truncate">{g.title}</span>
              {/* Honest status as text; the percent only while work is in progress (never 100% before the Goal check passes). */}
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {g.status === "active" ? `${g.percent}%` : STATUS_LABEL[g.status]}
              </span>
            </button>
            <button
              onClick={() => setConfirmId(g.id)}
              aria-label={`Delete ${g.title}`}
              className="mr-1 grid place-items-center rounded-md p-1.5 text-muted-foreground hover:text-destructive max-md:min-h-11 max-md:min-w-11"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </nav>
      <Button variant="ghost" className="justify-start gap-2 text-muted-foreground" asChild>
        <Link to="/billing">
          <CreditCard className="size-4" /> Plans and billing
        </Link>
      </Button>
      <Button
        variant="ghost"
        className="justify-start gap-2 text-muted-foreground"
        onClick={signOut}
      >
        <LogOut className="size-4" /> Sign out
      </Button>
      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this goal?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes its steps, proof, Goal check results and chat. It can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmId) sw.remove(confirmId);
                setConfirmId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CenterNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function PlanPanel({
  goal,
  sw,
  onNavigate,
}: {
  goal: Goal;
  sw: Stepwise;
  onNavigate?: () => void;
}) {
  const plan = E.planOf(goal);
  const [view, setView] = useState<"list" | "map">("list");
  const onMapStep = (id: string) => {
    if (E.stepStatus(id, goal.completed, plan) !== "available") return onStep(id);
    const cards = document.querySelectorAll<HTMLElement>(`[data-task-step="${CSS.escape(id)}"]`);
    const el = cards[cards.length - 1];
    if (!el) return;
    onNavigate?.();
    setTimeout(
      () => el.scrollIntoView({ behavior: "smooth", block: "start" }),
      onNavigate ? 300 : 0,
    );
  };
  const onStep = (id: string) => {
    if (E.stepStatus(id, goal.completed, plan) !== "locked") return;
    const p = E.firstUnmetPrereq(id, goal.completed, plan);
    if (p) toast(`Finish ${p.title} first`);
  };
  const pr = E.progress(goal);
  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center gap-3">
        <ProgressRing done={pr.done} total={pr.total} size={40} label={false} />
        <div>
          <div className="tabular text-sm font-semibold">
            {pr.done} of {pr.total} steps
          </div>
          <div className="text-xs text-muted-foreground">
            {goal.achieved ? "Goal met" : "Done when the Goal check passes"}
          </div>
        </div>
      </div>
      <Tabs value={view} onValueChange={(v) => setView(v as "list" | "map")}>
        <TabsList className="grid w-full grid-cols-2" aria-label="Plan view">
          <TabsTrigger value="list" className="max-md:min-h-11">
            List
          </TabsTrigger>
          <TabsTrigger value="map" className="max-md:min-h-11">
            Map
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div>
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Done means
        </div>
        <p className="mt-1 text-sm">{plan.doneMeans}</p>
      </div>
      {view === "map" ? (
        <PlanMap goal={goal} onStep={onMapStep} />
      ) : (
        <GroupedList goal={goal} onStep={onStep} />
      )}
      {(goal.revisions ?? 0) > 0 && E.replanOpen(goal) && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={sw.busy}
          onClick={sw.restorePlan}
        >
          Restore previous plan
        </Button>
      )}
      <div className="flex justify-end">
        <EndGoalButton goal={goal} sw={sw} />
      </div>
    </div>
  );
}

const GROUP_TITLE: Record<Group, string> = {
  now: "Now",
  next: "Next",
  later: "Later",
  done: "Done",
};

function GroupedList({ goal, onStep }: { goal: Goal; onStep: (id: string) => void }) {
  const plan = E.planOf(goal);
  const groups = groupSteps(goal);
  const [doneOpen, setDoneOpen] = useState(false);
  const allDone = goal.completed.length === plan.steps.length;
  const row = (id: string) => {
    const st = E.stepStatus(id, goal.completed, plan);
    const first = st === "locked" ? E.firstUnmetPrereq(id, goal.completed, plan) : null;
    return (
      <li key={id}>
        <button
          onClick={() => onStep(id)}
          className={cn(
            "flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition-colors duration-150 hover:bg-muted",
            st === "locked" && "text-muted-foreground",
          )}
        >
          <StatusIcon status={st} />
          <span className="sr-only">
            {st === "done" ? "Done" : st === "available" ? "Open" : "Locked"}:
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">
              {E.stepNumber(id, plan)}. {E.getStep(id, plan).title}
            </span>
            {first && <span className="block text-xs">Unlocks after {first.title}</span>}
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className="space-y-4">
      {(["now", "next", "later"] as const).map((k) =>
        groups[k].length ? (
          <section key={k} aria-label={GROUP_TITLE[k]}>
            <div className="px-2 pb-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {GROUP_TITLE[k]}
              {k === "now" && groups.now.length > 1 ? " · Any order" : ""}
            </div>
            <ul>{groups[k].map(row)}</ul>
          </section>
        ) : null,
      )}
      <div className="flex min-h-11 items-center gap-3 px-2 text-sm">
        <StatusIcon status={goal.achieved ? "done" : allDone ? "available" : "locked"} />
        <span className="sr-only">{goal.achieved ? "Done" : allDone ? "Open" : "Locked"}:</span>
        <span className={cn(!allDone && "text-muted-foreground")}>Goal check</span>
      </div>
      {groups.done.length > 0 && (
        <section aria-label="Done">
          <button
            onClick={() => setDoneOpen((o) => !o)}
            aria-expanded={doneOpen}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:bg-muted"
          >
            <span className="flex-1 text-left">Done · {groups.done.length}</span>
            <ChevronDown
              className={cn("size-4 transition-transform duration-200", doneOpen && "rotate-180")}
              aria-hidden
            />
          </button>
          {doneOpen && <ul className="animate-fold">{groups.done.map(row)}</ul>}
        </section>
      )}
    </div>
  );
}

function Composer({ onSend, autoFocus }: { onSend: (t: string) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  // Shorter placeholder on phones so it isn't cut off.
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const f = () => setPhone(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const send = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };
  return (
    <div className="flex items-end gap-2 rounded-3xl border bg-card p-2 shadow-float transition-shadow duration-200 focus-within:border-ring/60">
      <Textarea
        id="goal-composer"
        aria-label="Message"
        autoFocus={autoFocus}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={phone ? "Message Stepwise" : "Describe what you want to get done"}
        className="max-h-40 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <Button
        size="icon"
        className="size-11 shrink-0 rounded-full"
        onClick={send}
        disabled={!text.trim()}
        aria-label="Send"
      >
        <ArrowUp className="size-4" />
      </Button>
    </div>
  );
}

function Thread({ goal, sw }: { goal: Goal; sw: Stepwise }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [goal.messages.length]);

  const { latestFor, lastCheck, lastFail, lastIntake } = useMemo(() => {
    const latestFor: Record<string, string> = {};
    let lastCheck = "";
    let lastFail = "";
    let lastIntake = "";
    goal.messages.forEach((m) => {
      if (m.kind === "tasks") m.stepIds.forEach((id) => (latestFor[id] = m.id));
      if (m.kind === "check") lastCheck = m.id;
      if (m.kind === "checkFail") lastFail = m.id;
      if (m.kind === "intake") lastIntake = m.id;
    });
    return { latestFor, lastCheck, lastFail, lastIntake };
  }, [goal.messages]);

  return (
    <div
      className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Chat"
    >
      {goal.messages.map((m) => (
        <div key={m.id} className="animate-rise">
          {m.role === "user" ? (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm shadow-sm">
                {m.text}
              </div>
            </div>
          ) : m.kind === "activity" ? (
            <ActivityCard events={m.events} />
          ) : m.kind === "text" ? (
            <p className="text-sm">{m.text}</p>
          ) : m.kind === "goal" ? (
            <GoalCard goal={goal} sw={sw} />
          ) : m.kind === "tasks" ? (
            <TaskGroup goal={goal} stepIds={m.stepIds} sw={sw} latestFor={latestFor} msgId={m.id} />
          ) : m.kind === "intake" ? (
            <IntakeCard
              question={m.question}
              options={m.options}
              sw={sw}
              active={m.id === lastIntake && !goal.planned}
            />
          ) : m.kind === "check" ? (
            <CheckCard
              goal={goal}
              sw={sw}
              active={m.id === lastCheck && !goal.achieved && !isAfter(lastFail, m.id)}
            />
          ) : m.kind === "replanAsk" ? (
            <IntakeCard
              question={m.question}
              options={m.options}
              sw={sw}
              active={m.id === goal.messages[goal.messages.length - 1]?.id && !goal.paused}
            />
          ) : m.kind === "patch" ? (
            <PatchCard goal={goal} patchId={m.patchId} sw={sw} />
          ) : m.kind === "replanLimit" ? (
            <ReplanLimit
              sw={sw}
              active={m.id === goal.messages[goal.messages.length - 1]?.id && !goal.paused}
              lifecycle={!!goal.lifecyclePersisted}
            />
          ) : m.kind === "aiError" ? (
            <AiErrorLine
              sw={sw}
              retry={m.retry}
              active={m.id === goal.messages[goal.messages.length - 1]?.id}
            />
          ) : m.kind === "checkFail" ? (
            <CheckFail sw={sw} active={m.id === lastFail && !isAfter(lastCheck, m.id)} />
          ) : (
            <Recap goal={goal} />
          )}
        </div>
      ))}
      {sw.live && <LiveActivity events={sw.live} />}
      {sw.thinking && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Thinking…
        </div>
      )}
      {goal.paused && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Goal paused.</span>
          <Button
            variant="outline"
            size="sm"
            className="max-md:min-h-11"
            disabled={sw.busy}
            onClick={sw.resume}
          >
            Resume
          </Button>
        </div>
      )}
      <LifecycleBanner goal={goal} sw={sw} />
      <div ref={end} />
    </div>
  );
}

/** "Couldn't reach the assistant" with a Retry button that repeats the same request. */
function AiErrorLine({ sw, retry, active }: { sw: Stepwise; retry: string; active: boolean }) {
  let proofStep: string | null = null;
  try {
    const r = JSON.parse(retry) as { type?: string; stepId?: string };
    if (r.type === "proof" && r.stepId) proofStep = r.stepId;
  } catch {
    /* treat as a chat request */
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm">{E.AI_FAIL_LINE}</p>
      {active && (
        <Button
          variant="outline"
          size="sm"
          className="max-md:min-h-11"
          disabled={sw.busy}
          onClick={() => (proofStep ? sw.submit(proofStep) : sw.retryAi())}
        >
          Retry
        </Button>
      )}
    </div>
  );
}

function seqOf(id: string) {
  return Number(id.split("-").pop() ?? 0);
}
function isAfter(a: string, b: string) {
  return !!a && seqOf(a) > seqOf(b);
}

function EmptyState({ sw }: { sw: Stepwise }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
        What will you bring to life?
      </h1>
      <p className="text-center text-muted-foreground">
        Build, fix, learn, or create. Start with your goal and work toward a result you can check.
      </p>
      <Composer onSend={sw.send} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <Button
            key={s.label}
            variant="outline"
            size="sm"
            className="h-auto min-h-16 justify-start whitespace-normal rounded-2xl px-5 py-4 text-left"
            onClick={() => sw.send(s.prompt)}
            disabled={sw.busy}
          >
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function StepwiseApp() {
  const sw = useStepwise();
  const goal = sw.active;
  const [sideOpen, setSideOpen] = useState(true);
  const [mobileSide, setMobileSide] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const f = () => setDesktop(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const planned = !!goal?.planned;
  const pr = goal ? E.progress(goal) : null;
  const phase = goal
    ? derivePhase(goal, { planning: sw.planning, replanning: sw.replanning })
    : null;
  // Announce phase changes (not every activity tick) through a polite live region.
  const [announce, setAnnounce] = useState("");
  const lastPhase = useRef<string | null>(null);
  useEffect(() => {
    const key = goal ? `${goal.id}:${phase}` : null;
    if (
      key &&
      lastPhase.current &&
      lastPhase.current !== key &&
      lastPhase.current.startsWith(goal!.id)
    )
      setAnnounce(phase ? `Now: ${PHASE_ACTIVE[phase]}` : "Goal met");
    lastPhase.current = key;
  }, [goal, phase]);

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside
        className={cn(
          "hidden shrink-0 border-r bg-sidebar transition-[width] md:block",
          sideOpen ? "w-64" : "w-0 overflow-hidden border-r-0",
        )}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <span className="font-semibold tracking-tight">Stepwise</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSideOpen(false)}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
        <GoalList sw={sw} />
      </aside>

      <Sheet open={mobileSide} onOpenChange={setMobileSide}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetHeader className="px-4 pt-4">
            <SheetTitle>Stepwise</SheetTitle>
          </SheetHeader>
          <GoalList sw={sw} onPick={() => setMobileSide(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>
        <header className="sticky top-0 z-10 flex min-h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 py-1.5 backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden max-md:size-11"
            onClick={() => setMobileSide(true)}
            aria-label="Open goals"
          >
            <Menu className="size-4" />
          </Button>
          {!sideOpen && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:inline-flex"
              onClick={() => setSideOpen(true)}
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          )}
          {planned && pr && goal ? (
            <>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-sm font-semibold">Goal: {E.planOf(goal).goal}</div>
                  {goal.status && <StatusChip status={goal.status} />}
                </div>
                <div className="hidden md:block">
                  <PhaseTracker list={phases(goal)} current={phase} />
                </div>
              </div>
              <div className="md:hidden">
                <PhasePill
                  current={phase}
                  done={pr.done}
                  total={pr.total}
                  expanded={planOpen}
                  onClick={() => setPlanOpen((o) => !o)}
                />
              </div>
              <button
                onClick={() => setPlanOpen((o) => !o)}
                aria-label={`Plan, ${pr.done} of ${pr.total} steps`}
                aria-expanded={planOpen}
                className="hidden min-h-11 shrink-0 items-center rounded-full px-2 hover:bg-muted md:inline-flex"
              >
                <ProgressRing done={pr.done} total={pr.total} />
              </button>
            </>
          ) : goal && goal.messages.length > 0 ? (
            <div className="min-w-0 flex-1">
              <PhaseTracker list={phases(goal)} current={phase} />
            </div>
          ) : (
            <span className="font-semibold tracking-tight md:hidden">Stepwise</span>
          )}
        </header>

        {sw.goalError ? (
          <CenterNote>
            <p>Couldn't load this goal.</p>
            <Button variant="outline" size="sm" onClick={() => sw.retryGoal()}>
              Try again
            </Button>
          </CenterNote>
        ) : sw.goalLoading ? (
          <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6" aria-busy="true">
            <p className="sr-only">Loading your goal…</p>
            <div className="shimmer h-5 w-2/3 rounded-full" />
            <div className="shimmer h-40 rounded-2xl" />
            <div className="shimmer ml-auto h-10 w-1/2 rounded-2xl" />
            <div className="shimmer h-56 rounded-2xl" />
          </div>
        ) : planned && goal ? (
          <>
            <div className="flex-1 overflow-y-auto">
              <Thread goal={goal} sw={sw} />
            </div>
            {goal.status !== "abandoned" && (
              <div className="mx-auto w-full max-w-2xl px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-4">
                <Composer onSend={sw.send} />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 overflow-y-auto">
            {goal && (goal.messages.length > 0 || sw.live) ? (
              <div className="flex w-full flex-col">
                <div className="flex-1">
                  <Thread goal={goal} sw={sw} />
                </div>
                <EmptyState sw={sw} />
              </div>
            ) : (
              <EmptyState sw={sw} />
            )}
          </div>
        )}
      </main>

      {planned && goal && planOpen && desktop && (
        <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card lg:block">
          <div className="flex h-14 items-center border-b px-4 font-semibold">Plan</div>
          <PlanPanel goal={goal} sw={sw} />
        </aside>
      )}
      {planned && goal && (
        <Sheet open={planOpen && !desktop} onOpenChange={setPlanOpen}>
          <SheetContent side="right" className="w-[88vw] max-w-sm overflow-y-auto p-0">
            <SheetHeader className="border-b px-4 py-4">
              <SheetTitle>Plan</SheetTitle>
            </SheetHeader>
            <PlanPanel goal={goal} sw={sw} onNavigate={() => setPlanOpen(false)} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
