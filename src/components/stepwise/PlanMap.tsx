import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import * as E from "@/lib/engine";
import type { Goal } from "@/lib/engine";
import { StatusIcon } from "./Cards";

const NODE_W = 130;
const NODE_H = 76;
const GAP_X = 20;
const GAP_Y = 44;
const PAD = 12;

const STATUS_LABEL: Record<E.StepStatus, string> = {
  done: "Done",
  available: "Open",
  locked: "Locked",
};

/**
 * Dependency map: rows are layers by longest prerequisite path (from the engine),
 * steps in the same row are parallel. Arrows run from each prerequisite to its dependent.
 */
export function PlanMap({ goal, onStep }: { goal: Goal; onStep: (id: string) => void }) {
  const plan = E.planOf(goal);
  const levels = E.stepLevels(plan);
  // Full step name shown on hover, focus or long-press.
  const [peek, setPeek] = useState<string | null>(null);
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; long: boolean }>({
    t: null,
    long: false,
  });
  if (!plan.steps.length)
    return <p className="text-sm text-muted-foreground">No steps in this plan yet.</p>;

  const widest = Math.max(...levels.map((l) => l.length));
  const width = PAD * 2 + widest * NODE_W + (widest - 1) * GAP_X;
  const height = PAD * 2 + levels.length * NODE_H + (levels.length - 1) * GAP_Y;
  const pos: Record<string, { x: number; y: number }> = {};
  levels.forEach((ids, row) => {
    const rowW = ids.length * NODE_W + (ids.length - 1) * GAP_X;
    const start = (width - rowW) / 2;
    ids.forEach((id, i) => {
      pos[id] = { x: start + i * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y) };
    });
  });

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="relative mx-auto" style={{ width, height }} role="list" aria-label="Plan map">
        <svg
          className="absolute inset-0 text-border"
          width={width}
          height={height}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="plan-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {plan.steps.flatMap((s) => {
            const b = pos[s.id]!;
            // Spread arrow ends along the target's top edge, ordered left to right by source.
            const ins = s.prereqs.filter((r) => pos[r]).sort((x, y) => pos[x]!.x - pos[y]!.x);
            return ins.map((r, i) => {
              const a = pos[r]!;
              const outs = plan.steps
                .filter((d) => d.prereqs.includes(r) && pos[d.id])
                .sort((x, y) => pos[x.id]!.x - pos[y.id]!.x);
              const j = outs.findIndex((d) => d.id === s.id);
              const x1 = a.x + (NODE_W * (j + 1)) / (outs.length + 1);
              const y1 = a.y + NODE_H;
              const x2 = b.x + (NODE_W * (i + 1)) / (ins.length + 1);
              const y2 = b.y - 2;
              const my = (y1 + y2) / 2;
              return (
                <path
                  key={`${r}-${s.id}`}
                  d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  markerEnd="url(#plan-arrow)"
                />
              );
            });
          })}
        </svg>
        {plan.steps.map((s) => {
          const st = E.stepStatus(s.id, goal.completed, plan);
          const p = pos[s.id]!;
          return (
            <button
              key={s.id}
              role="listitem"
              onClick={() => {
                if (press.current.long) {
                  press.current.long = false;
                  return;
                }
                onStep(s.id);
              }}
              onMouseEnter={() => setPeek(s.id)}
              onMouseLeave={() => setPeek((p) => (p === s.id ? null : p))}
              onFocus={() => setPeek(s.id)}
              onBlur={() => setPeek((p) => (p === s.id ? null : p))}
              onTouchStart={() => {
                press.current.long = false;
                press.current.t = setTimeout(() => {
                  press.current.long = true;
                  setPeek(s.id);
                }, 500);
              }}
              onTouchEnd={() => {
                if (press.current.t) clearTimeout(press.current.t);
              }}
              onTouchMove={() => {
                if (press.current.t) clearTimeout(press.current.t);
              }}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={`Step ${E.stepNumber(s.id, plan)}, ${s.title}: ${STATUS_LABEL[st]}`}
              className={cn(
                "absolute flex flex-col gap-1 rounded-xl border bg-card p-2 text-left text-xs shadow-card transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                st === "available" && "border-primary",
                st === "locked" && "text-muted-foreground",
              )}
              style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
            >
              <span className="flex items-center gap-1.5">
                <StatusIcon status={st} />
                <span className="font-mono text-[10px] uppercase tracking-wider">
                  {E.stepNumber(s.id, plan)} · {STATUS_LABEL[st]}
                </span>
              </span>
              <span className="line-clamp-2 leading-tight">{s.title}</span>
            </button>
          );
        })}
        {peek && pos[peek] && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-card"
            style={{
              left: Math.max(0, pos[peek]!.x - 10),
              top: pos[peek]!.y + NODE_H + 4,
              width: NODE_W + 20,
            }}
          >
            {E.getStep(peek, plan).title}
          </div>
        )}
      </div>
    </div>
  );
}
