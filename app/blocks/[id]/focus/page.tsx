"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type BlockStatus = "planned" | "active" | "done";
type TimerState = "paused" | "running";
type TaskStatus = "backlog" | "planned" | "in_progress" | "done";

type FocusTask = {
  id: string;
  name: string;
  meta: string;
  completed: boolean;
  status: TaskStatus;
  order: number;
  studyBlockId: string | null;
};

type FocusBlock = {
  id: string;
  dayKey: string;
  title: string;
  startMinutes: number;
  durationMin: number;
  status: BlockStatus;
  timerState: TimerState;
  remainingSeconds: number;
  effectiveRemainingSeconds: number;
  runningSince: string | null;
  activeTaskId: string | null;
};

function toHumanTime(startMinutes: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(1970, 0, 1, Math.floor(startMinutes / 60), startMinutes % 60));
}

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remSeconds = safeSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remSeconds).padStart(2, "0")}`;
}

export default function FocusModePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const blockId = params.id;

  const [block, setBlock] = useState<FocusBlock | null>(null);
  const [tasks, setTasks] = useState<FocusTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [hasShownCompletionPrompt, setHasShownCompletionPrompt] = useState(false);

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === block?.activeTaskId) ?? null,
    [block?.activeTaskId, tasks],
  );

  const displayRemainingSeconds = useMemo(() => {
    if (!block) return 0;
    if (block.timerState !== "running" || !block.runningSince) {
      return block.effectiveRemainingSeconds;
    }

    const runningSince = new Date(block.runningSince);
    const elapsed = Math.floor((nowMs - runningSince.getTime()) / 1000);
    return Math.max(0, block.remainingSeconds - elapsed);
  }, [block, nowMs]);

  const fetchFocusState = useCallback(async () => {
    try {
      setErrorMessage(null);
      const response = await fetch(`/api/blocks/${blockId}/focus`);
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        throw new Error("Unable to load focus mode data.");
      }
      const payload = (await response.json()) as { block: FocusBlock; tasks: FocusTask[] };
      setBlock(payload.block);
      setTasks(payload.tasks ?? []);
    } catch (error) {
      console.error("Loading focus mode failed", error);
      setErrorMessage("Could not load focus mode.");
    } finally {
      setIsLoading(false);
    }
  }, [blockId, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchFocusState();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchFocusState]);

  useEffect(() => {
    if (!block || block.timerState !== "running") return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [block]);

  useEffect(() => {
    if (!block || block.timerState !== "running") return;
    const interval = window.setInterval(() => {
      void fetchFocusState();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [block, fetchFocusState]);

  useEffect(() => {
    if (!block) return;
    if (displayRemainingSeconds > 0) return;
    if (hasShownCompletionPrompt) return;

    const timer = window.setTimeout(() => {
      setHasShownCompletionPrompt(true);
      setNotice("Focus session reached zero. End the block when you're ready.");
      if (block.timerState === "running") {
        void fetch("/api/blocks/" + block.id + "/focus/timer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pause" }),
        }).then(() => {
          void fetchFocusState();
        });
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [block, displayRemainingSeconds, fetchFocusState, hasShownCompletionPrompt]);

  const updateTimerState = async (action: "pause" | "resume") => {
    try {
      setIsSaving(true);
      setErrorMessage(null);
      const response = await fetch(`/api/blocks/${blockId}/focus/timer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        throw new Error("Unable to update timer state.");
      }
      if (action === "resume") {
        setHasShownCompletionPrompt(false);
      }
      await fetchFocusState();
    } catch (error) {
      console.error("Updating timer state failed", error);
      setErrorMessage("Could not update timer.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEndBlock = async () => {
    try {
      setIsSaving(true);
      setErrorMessage(null);
      const response = await fetch(`/api/blocks/${blockId}/end`, { method: "POST" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        throw new Error("Unable to end block.");
      }
      router.replace("/blocks");
    } catch (error) {
      console.error("Ending block failed", error);
      setErrorMessage("Could not end block.");
    } finally {
      setIsSaving(false);
    }
  };

  const setActiveTask = async (taskId: string | null) => {
    try {
      setIsSaving(true);
      setErrorMessage(null);
      const response = await fetch(`/api/blocks/${blockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeTaskId: taskId }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        throw new Error("Unable to update active task.");
      }
      await fetchFocusState();
    } catch (error) {
      console.error("Updating active task failed", error);
      setErrorMessage("Could not update active task.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkDone = async (task: FocusTask) => {
    const markAsDone = window.confirm(
      "Mark this task as done now?\n\nOK = Done now\nCancel = Keep as planned",
    );

    try {
      setIsSaving(true);
      setErrorMessage(null);

      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: markAsDone ? "done" : "planned",
          completed: markAsDone,
        }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        throw new Error("Unable to update task.");
      }

      if (block?.activeTaskId === task.id) {
        const nextTask = tasks.find((candidate) => candidate.id !== task.id && !candidate.completed);
        await setActiveTask(nextTask?.id ?? null);
      } else {
        await fetchFocusState();
      }
      setNotice(markAsDone ? "Task marked done." : "Task kept in planned.");
    } catch (error) {
      console.error("Marking focus task failed", error);
      setErrorMessage("Could not update task status.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[760px] py-10">
        <div className="h-[420px] animate-pulse rounded-[18px] border" style={{ borderColor: "var(--line)" }} />
      </div>
    );
  }

  if (!block) {
    return (
      <div className="mx-auto max-w-[760px] py-10">
        <p className="text-[0.92rem]" style={{ color: "var(--danger)" }}>
          Focus block not found.
        </p>
      </div>
    );
  }

  const progressPercent =
    block.durationMin > 0
      ? Math.min(100, Math.max(0, (displayRemainingSeconds / (block.durationMin * 60)) * 100))
      : 0;

  return (
    <div className="mx-auto max-w-[760px] py-10 text-center">
      <button
        type="button"
        onClick={() => router.push("/blocks")}
        className="mb-7 inline-flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[0.84rem] font-medium"
        style={{ background: "var(--surface-solid)", color: "var(--text-2)" }}
      >
        <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" style={{ stroke: "currentColor" }}>
          <path d="M10 12 6 8l4-4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Exit focus
      </button>

      <p className="text-[0.78rem] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--accent)" }}>
        Active block
      </p>
      <h1 className="mt-2 text-[2.3rem] font-bold tracking-[-0.035em]">{block.title}</h1>
      <p className="mt-2 text-[0.92rem]" style={{ color: "var(--text-2)" }}>
        {toHumanTime(block.startMinutes)} - {toHumanTime(block.startMinutes + block.durationMin)} · {block.durationMin}m
      </p>

      <div className="relative mx-auto mt-10 h-[280px] w-[280px]">
        <svg viewBox="0 0 280 280" className="h-full w-full -rotate-90">
          <circle cx="140" cy="140" r="133" fill="none" stroke="var(--line)" strokeWidth="6" />
          <circle
            cx="140"
            cy="140"
            r="133"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={835.66}
            strokeDashoffset={835.66 - (835.66 * progressPercent) / 100}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div>
            <div className="text-[3.2rem] font-bold leading-none tracking-[-0.05em]">
              {formatClock(displayRemainingSeconds)}
            </div>
            <div className="mt-2 text-[0.82rem]" style={{ color: "var(--text-2)" }}>
              {block.timerState === "running" ? "running" : "paused"} · remaining in this block
            </div>
          </div>
        </div>
      </div>

      {activeTask ? (
        <section
          className="mx-auto mt-8 max-w-[500px] rounded-[16px] border px-5 py-4 text-left"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
        >
          <p className="text-[0.74rem] font-semibold uppercase tracking-[0.05em]" style={{ color: "#ff9500" }}>
            Now working on
          </p>
          <p className="mt-1 text-[1.02rem] font-semibold">{activeTask.name}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleMarkDone(activeTask)}
              className="h-8 rounded-[8px] bg-[var(--done)] px-3 text-[0.78rem] font-semibold text-white"
            >
              Mark done
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void setActiveTask(null)}
              className="h-8 rounded-[8px] border px-3 text-[0.78rem] font-semibold"
              style={{ borderColor: "var(--line)" }}
            >
              Clear active task
            </button>
          </div>
        </section>
      ) : null}

      <div className="mt-7 flex justify-center gap-2">
        <button
          type="button"
          disabled={isSaving || displayRemainingSeconds <= 0 || block.timerState === "running"}
          onClick={() => void updateTimerState("resume")}
          className="h-10 rounded-[10px] px-5 text-[0.86rem] font-semibold text-white"
          style={{
            background: "var(--accent)",
            opacity: isSaving || displayRemainingSeconds <= 0 || block.timerState === "running" ? 0.6 : 1,
          }}
        >
          {displayRemainingSeconds <= 0 ? "Complete" : "Resume"}
        </button>
        <button
          type="button"
          disabled={isSaving || block.timerState !== "running"}
          onClick={() => void updateTimerState("pause")}
          className="h-10 rounded-[10px] border px-5 text-[0.86rem] font-semibold"
          style={{
            borderColor: "var(--line)",
            opacity: isSaving || block.timerState !== "running" ? 0.6 : 1,
          }}
        >
          Pause
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void handleEndBlock()}
          className="h-10 rounded-[10px] border px-5 text-[0.86rem] font-semibold"
          style={{ borderColor: "var(--line)" }}
        >
          End block
        </button>
      </div>

      {errorMessage ? (
        <p className="mt-4 text-[0.84rem]" style={{ color: "var(--danger)" }}>
          {errorMessage}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 text-[0.84rem]" style={{ color: "var(--done)" }}>
          {notice}
        </p>
      ) : null}

      <section className="mx-auto mt-10 max-w-[500px] text-left">
        <h2 className="mb-2 text-[0.75rem] font-semibold uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>
          Tasks in this block
        </h2>
        <div className="space-y-1.5">
          {tasks.length === 0 ? (
            <p className="text-[0.84rem]" style={{ color: "var(--text-2)" }}>
              No tasks linked to this block yet.
            </p>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-2 rounded-[10px] border px-3 py-2.5"
                style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
              >
                <div className="min-w-0">
                  <p
                    className="truncate text-[0.9rem] font-medium"
                    style={{
                      textDecoration: task.status === "done" ? "line-through" : "none",
                      color: task.status === "done" ? "var(--text-3)" : "var(--text)",
                    }}
                  >
                    {task.name}
                  </p>
                  {task.meta ? (
                    <p className="text-[0.75rem]" style={{ color: "var(--text-3)" }}>
                      {task.meta}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void setActiveTask(task.id)}
                    className="h-7 rounded-[8px] border px-2.5 text-[0.72rem] font-semibold"
                    style={{
                      borderColor: "var(--line)",
                      background: block.activeTaskId === task.id ? "var(--accent-soft)" : "transparent",
                      color: block.activeTaskId === task.id ? "var(--accent)" : "var(--text-2)",
                    }}
                    disabled={isSaving}
                  >
                    {block.activeTaskId === task.id ? "Active" : "Set active"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleMarkDone(task)}
                    className="h-7 rounded-[8px] border px-2.5 text-[0.72rem] font-semibold"
                    style={{ borderColor: "var(--line)" }}
                    disabled={isSaving}
                  >
                    Mark done
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

