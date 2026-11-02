import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { Goal, ProofValue } from "./engine";
import { planForText } from "./engine";
import { PLANS } from "./plan";
import { LABELS, type ActivityEvent, type ActivityPhase } from "./activity";
import { supabase } from "@/integrations/supabase/client";
import {
  createGoal,
  deleteGoal,
  getGoal,
  goalAction,
  listGoals,
  submitGoalCheck,
  submitProof,
  type ActionResult,
} from "./goals.functions";

const ACTIVE_KEY = "stepwise-active-goal";

/** Unsent answers the user is typing. They stay in the browser until submitted. */
interface Draft {
  proofs: Record<string, Record<string, ProofValue>>;
  ack: Record<string, boolean>;
  checkValue: string;
  checkProofs: Record<string, ProofValue>;
}
const emptyDraft = (): Draft => ({ proofs: {}, ack: {}, checkValue: "", checkProofs: {} });

export const SAVE_ERROR = "Couldn't save your proof. Try again.";
const ACTION_ERROR = "Couldn't save that. Try again.";

export function useStepwise() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  /** True while the backend is writing a plan for a custom goal. */
  const [planning, setPlanning] = useState(false);
  /** The step whose photo the AI is checking right now. */
  const [checking, setChecking] = useState<string | null>(null);
  /** True while the AI writes a plan update. */
  const [replanning, setReplanning] = useState(false);
  /** True while the AI writes a hint, side answer or intake question. */
  const [thinking, setThinking] = useState(false);
  /** Live activity card lines while the agent works (display only). */
  const [live, setLive] = useState<ActivityEvent[] | null>(null);
  const startLive = (phase: ActivityPhase, label: string) =>
    setLive([{ id: "live", phase, label, status: "running", startedAt: Date.now() }]);
  /** The plan update being applied right now. */
  const [applying, setApplying] = useState<string | null>(null);

  const listFn = useServerFn(listGoals);
  const getFn = useServerFn(getGoal);
  const createFn = useServerFn(createGoal);
  const actionFn = useServerFn(goalAction);
  const proofFn = useServerFn(submitProof);
  const checkFn = useServerFn(submitGoalCheck);
  const deleteFn = useServerFn(deleteGoal);

  useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_KEY);
    if (saved) setActiveId(saved);
  }, []);
  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  }, [activeId]);

  const goalsQ = useQuery({ queryKey: ["goals"], queryFn: () => listFn() });
  const goalQ = useQuery({
    queryKey: ["goal", activeId],
    queryFn: () => getFn({ data: { goalId: activeId! } }),
    enabled: !!activeId,
    retry: false,
  });

  // A remembered goal that no longer exists (deleted elsewhere): fall back to the empty state.
  // Wait for a fresh list so a just-created goal isn't dropped by a stale one.
  useEffect(() => {
    if (
      activeId &&
      goalsQ.data &&
      !goalsQ.isFetching &&
      !goalsQ.data.some((g) => g.id === activeId)
    )
      setActiveId(null);
  }, [activeId, goalsQ.data, goalsQ.isFetching]);

  const server = goalQ.data ?? null;
  const draft = (server && drafts[server.id]) || emptyDraft();

  const active: Goal | null = useMemo(() => {
    if (!server) return null;
    const proofs = { ...server.proofs };
    for (const [stepId, vals] of Object.entries(draft.proofs)) {
      if (!server.completed.includes(stepId))
        proofs[stepId] = { ...(proofs[stepId] ?? {}), ...vals };
    }
    return {
      ...server,
      proofs,
      ack: { ...server.ack, ...draft.ack },
      checkValue: draft.checkValue,
      checkProofs: draft.checkProofs,
    };
  }, [server, draft]);

  const editDraft = useCallback(
    (fn: (d: Draft) => Draft) => {
      if (!server) return;
      setDrafts((all) => ({ ...all, [server.id]: fn(all[server.id] ?? emptyDraft()) }));
    },
    [server],
  );

  const applyResult = (res: ActionResult) => {
    if (!res.ok) {
      toast(res.reason);
      return false;
    }
    // Another window or a double tap saved first: show the latest goal and say so.
    if (res.notice) toast(res.notice);
    qc.setQueryData(["goal", res.goal.id], res.goal);
    void qc.invalidateQueries({ queryKey: ["goals"] });
    return true;
  };

  const run = async (fn: () => Promise<boolean | void>, errorText = ACTION_ERROR) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast.error(errorText);
    } finally {
      setBusy(false);
    }
  };

  /** The goal to act on; creates an empty one when nothing is selected. */
  const ensureGoal = async (): Promise<Goal> => {
    if (server && activeId === server.id) return server;
    const g = await createFn();
    qc.setQueryData(["goal", g.id], g);
    setActiveId(g.id);
    void qc.invalidateQueries({ queryKey: ["goals"] });
    return g;
  };

  type Action =
    | { type: "text"; text: string }
    | { type: "pick"; planId: string }
    | { type: "start" }
    | { type: "stuck"; stepId: string }
    | { type: "startTimer"; stepId: string }
    | { type: "timerDone"; stepId: string }
    | { type: "applyPatch"; patchId: string }
    | { type: "keepPatch"; patchId: string }
    | { type: "restorePlan" }
    | { type: "pause" }
    | { type: "resume" }
    | { type: "anotherApproach" }
    | { type: "retryAi" }
    | { type: "end"; reason: string }
    | { type: "escalate" }
    | { type: "resolveEscalation" };
  const act = (action: Action) =>
    run(async () => {
      const g = await ensureGoal();
      // A custom goal may need plan generation: show "Building your plan…" while it runs.
      const mayPlan =
        action.type === "text" &&
        !g.planned &&
        !planForText(action.text, PLANS) &&
        (g.intake?.length ?? 0) >= 2;
      // Answering the replan question asks the AI for a plan update.
      const last = g.messages[g.messages.length - 1];
      const mayReplan = action.type === "text" && last?.kind === "replanAsk";
      // Hints, side answers and intake questions show "Thinking…" while the AI works.
      // A custom goal's intake questions show the activity card ("Understanding your goal").
      const mayIntake =
        action.type === "text" &&
        !g.planned &&
        !planForText(action.text, PLANS) &&
        !mayPlan &&
        !mayReplan;
      const mayThink =
        (action.type === "text" || action.type === "stuck" || action.type === "retryAi") &&
        !mayPlan &&
        !mayReplan &&
        !mayIntake;
      if (mayIntake) startLive("understand", LABELS.understand);
      if (mayPlan) startLive("plan", LABELS.plan);
      if (mayReplan) startLive("plan", LABELS.replan);
      if (mayPlan) setPlanning(true);
      if (mayReplan) setReplanning(true);
      if (mayThink) setThinking(true);
      if (action.type === "applyPatch") setApplying(action.patchId);
      try {
        return applyResult(await actionFn({ data: { goalId: g.id, action } }));
      } finally {
        if (mayPlan) setPlanning(false);
        if (mayReplan) setReplanning(false);
        if (mayThink) setThinking(false);
        if (mayIntake || mayPlan || mayReplan) setLive(null);
        if (action.type === "applyPatch") setApplying(null);
      }
    });

  return {
    goals: goalsQ.data ?? [],
    goalsLoading: goalsQ.isLoading,
    goalsError: goalsQ.isError,
    retryGoals: () => goalsQ.refetch(),
    activeId,
    active,
    goalLoading: !!activeId && goalQ.isLoading,
    goalError: !!activeId && goalQ.isError,
    retryGoal: () => goalQ.refetch(),
    busy,
    planning,
    checking,
    replanning,
    thinking,
    live,
    applying,
    retryAi: () => act({ type: "retryAi" }),
    applyPatch: (patchId: string) => act({ type: "applyPatch", patchId }),
    keepPatch: (patchId: string) => act({ type: "keepPatch", patchId }),
    restorePlan: () => act({ type: "restorePlan" }),
    pause: () => act({ type: "pause" }),
    resume: () => act({ type: "resume" }),
    anotherApproach: () => act({ type: "anotherApproach" }),
    /** Ends the goal without a verified result (needs the lifecycle columns). */
    endGoal: (reason: string) => act({ type: "end", reason }),
    /** Puts the goal on hold for a qualified professional. */
    escalate: () => act({ type: "escalate" }),
    /** The user confirms it's safe to continue a goal on hold. */
    resolveEscalation: () => act({ type: "resolveEscalation" }),
    startTimer: (stepId: string) => act({ type: "startTimer", stepId }),
    /** Called by the countdown when it hits zero; the server posts the line once. */
    timerDone: async (stepId: string) => {
      if (!server) return;
      try {
        const res = await actionFn({
          data: { goalId: server.id, action: { type: "timerDone", stepId } },
        });
        if (res.ok) qc.setQueryData(["goal", res.goal.id], res.goal);
      } catch (e) {
        console.error(e);
      }
    },
    /** Uploads a proof photo to private storage and returns its path. */
    uploadPhoto: async (stepId: string, itemId: string, file: File): Promise<string> => {
      if (!server) throw new Error("No goal");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Signed out");
      const ext =
        (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${u.user.id}/${server.id}/${stepId}-${itemId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("proof-photos")
        .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (error) throw error;
      return path;
    },
    newGoal: () => run(async () => void (await ensureGoalFresh())),
    select: (id: string) => setActiveId(id),
    remove: (id: string) =>
      run(async () => {
        await deleteFn({ data: { goalId: id } });
        qc.removeQueries({ queryKey: ["goal", id] });
        if (activeId === id) setActiveId(null);
        await qc.invalidateQueries({ queryKey: ["goals"] });
        toast("Goal deleted.");
      }, "Couldn't delete the goal. Try again."),
    send: (text: string) => act({ type: "text", text }),
    pickPlan: (planId: string) => act({ type: "pick", planId }),
    start: () => act({ type: "start" }),
    stuck: (stepId: string) => act({ type: "stuck", stepId }),
    retry: () =>
      run(async () => {
        editDraft((d) => ({ ...d, checkValue: "", checkProofs: {} }));
        if (server)
          applyResult(await actionFn({ data: { goalId: server.id, action: { type: "retry" } } }));
      }),
    setProof: (stepId: string, itemId: string, v: ProofValue) =>
      editDraft((d) => ({
        ...d,
        proofs: { ...d.proofs, [stepId]: { ...(d.proofs[stepId] ?? {}), [itemId]: v } },
      })),
    setAck: (stepId: string, v: boolean) =>
      editDraft((d) => ({ ...d, ack: { ...d.ack, [stepId]: v } })),
    setCheck: (v: string) => editDraft((d) => ({ ...d, checkValue: v })),
    setCheckProof: (itemId: string, v: ProofValue) =>
      editDraft((d) => ({ ...d, checkProofs: { ...d.checkProofs, [itemId]: v } })),
    submit: (stepId: string, override?: string) =>
      run(async () => {
        if (!active) return;
        const step = active.plan?.steps.find((x) => x.id === stepId);
        const photo = !override && !!step?.proof.some((it) => it.kind === "photo");
        if (photo) {
          setChecking(stepId);
          startLive("do", LABELS.photo);
        }
        try {
          const values: Record<string, boolean | string> = {};
          for (const [k, v] of Object.entries(active.proofs[stepId] ?? {}))
            if (v !== undefined) values[k] = v;
          return applyResult(
            await proofFn({
              data: {
                goalId: active.id,
                stepId,
                acknowledged: !!active.ack[stepId],
                values,
                override,
              },
            }),
          );
        } finally {
          if (photo) {
            setChecking(null);
            setLive(null);
          }
        }
      }, SAVE_ERROR),
    submitCheck: () =>
      run(async () => {
        if (!active) return;
        const answers: Record<string, "pass" | "fail"> = {};
        for (const [k, v] of Object.entries(active.checkProofs ?? {}))
          if (v === "pass" || v === "fail") answers[k] = v;
        return applyResult(
          await checkFn({ data: { goalId: active.id, value: active.checkValue, answers } }),
        );
      }, SAVE_ERROR),
  };

  async function ensureGoalFresh() {
    const g = await createFn();
    qc.setQueryData(["goal", g.id], g);
    setActiveId(g.id);
    await qc.invalidateQueries({ queryKey: ["goals"] });
  }
}

export type Stepwise = ReturnType<typeof useStepwise>;
