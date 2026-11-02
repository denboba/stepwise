// Lifecycle UI (ADR-0001): honest status chip, hold/ended banners and "End goal". Every control calls a
// server action; the server decides the status (src/lib/lifecycle.ts).
import { useState } from "react";
import { OctagonAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Goal } from "@/lib/engine";
import { STATUS_HELP, STATUS_LABEL, TERMINAL, type GoalStatus } from "@/lib/lifecycle";
import type { Stepwise } from "@/lib/store";

const TONE: Partial<Record<GoalStatus, string>> = {
  achieved: "bg-success text-success-foreground",
  escalated: "bg-destructive/10 text-destructive",
  unresolved: "bg-warning/15 text-foreground",
  blocked: "bg-warning/15 text-foreground",
  abandoned: "bg-muted text-muted-foreground",
};

/** Status as text (never color alone), with the meaning available to hover and screen readers. */
export function StatusChip({ status }: { status: GoalStatus }) {
  return (
    <span
      title={STATUS_HELP[status]}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE[status] ?? "bg-accent text-accent-foreground",
      )}
    >
      <span className="sr-only">Status: </span>
      {STATUS_LABEL[status]}
      <span className="sr-only">. {STATUS_HELP[status]}</span>
    </span>
  );
}

/** Shown in the conversation while a goal is on hold for safety or after it was ended. */
export function LifecycleBanner({ goal, sw }: { goal: Goal; sw: Stepwise }) {
  if (goal.status === "escalated")
    return (
      <div
        role="status"
        className="space-y-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
      >
        <div className="flex items-center gap-2 font-semibold text-destructive">
          <OctagonAlert className="size-4" aria-hidden /> On hold for safety
        </div>
        {goal.statusReason && <p>Reason: {goal.statusReason}.</p>}
        <p className="text-muted-foreground">
          Stepwise won't guide hands-on steps until it's safe. Continue only when the danger is gone
          or a qualified professional has dealt with it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="max-md:min-h-11"
            disabled={sw.busy}
            onClick={sw.resolveEscalation}
          >
            It's safe to continue
          </Button>
          <EndGoalButton goal={goal} sw={sw} />
        </div>
      </div>
    );
  if (goal.status === "abandoned")
    return (
      <div role="status" className="rounded-2xl border bg-muted/40 p-4 text-sm">
        <p className="font-semibold">Goal ended without a verified result.</p>
        {goal.statusReason && <p className="mt-1 text-muted-foreground">{goal.statusReason}</p>}
      </div>
    );
  return null;
}

/** "End goal" with a required reason. Only when the lifecycle columns exist and the goal isn't final. */
export function EndGoalButton({ goal, sw }: { goal: Goal; sw: Stepwise }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!goal.lifecyclePersisted || !goal.status || TERMINAL.has(goal.status)) return null;
  const ok = reason.trim().length >= 3;
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground max-md:min-h-11"
        disabled={sw.busy}
        onClick={() => setOpen(true)}
      >
        End goal
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this goal?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be recorded as ended without a verified result. Your steps, evidence and chat
              stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block text-sm">
            Why are you ending it?
            <Textarea
              className="mt-1"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: replaced the device instead"
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <Button
              disabled={!ok || sw.busy}
              onClick={() => {
                sw.endGoal(reason.trim());
                setOpen(false);
                setReason("");
              }}
            >
              End goal
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
