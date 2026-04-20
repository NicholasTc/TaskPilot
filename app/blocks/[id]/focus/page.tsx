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
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remSeconds).padStart(2, "0")}`;
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
      <div className="focus-bg -mx-6 -mt-10 min-h-[calc(100vh-56px)] px-6 py-10">
        <div className="mx-auto max-w-[760px]">
          <div
            className="h-[420px] animate-pulse rounded-[18px] border"
            style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
          />
        </div>
      </div>
    );
  }

  if (!block) {
    return (
      <div className="focus-bg -mx-6 -mt-10 min-h-[calc(100vh-56px)] px-6 py-10">
        <div className="mx-auto max-w-[760px]">
          <p className="text-[0.92rem]" style={{ color: "var(--danger)" }}>
            Focus block not found.
          </p>
        </div>
      </div>
    );
  }

  const isComplete = displayRemainingSeconds <= 0;
  const isRunning = block.timerState === "running" && !isComplete;
  const focusTitle = activeTask?.name ?? (tasks.length === 0 ? "No tasks in this block" : "Pick a task to focus on");
  const focusMeta = `${toHumanTime(block.startMinutes)} – ${toHumanTime(block.startMinutes + block.durationMin)}  ·  ${block.title}`;

  return (
    <div className="focus-bg -mx-6 -mt-10 min-h-[calc(100vh-56px)] px-6 pb-16 pt-10">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/blocks")}
            className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[0.84rem] font-medium transition-colors hover:bg-[var(--surface-solid)]"
            style={{ color: "var(--text-2)" }}
          >
            <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12 6 8l4-4" />
            </svg>
            Exit focus
          </button>
          <div
            className="inline-flex items-center text-[0.82rem] font-semibold"
            style={{ color: "var(--text-2)" }}
          >
            <span
              className="pulse-dot mr-2 inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: isRunning ? "var(--warn)" : "var(--text-3)" }}
            />
            {isComplete
              ? "Session complete"
              : isRunning
                ? "Focus session running"
                : "Focus session paused"}
          </div>
        </div>

        <section
          className="anim mx-auto rounded-[20px] border px-7 py-9 text-center"
          style={{
            background: "var(--surface-solid)",
            borderColor: "var(--line)",
            boxShadow: "var(--shadow-md)",
            maxWidth: 720,
          }}
        >
          <div
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.74rem] font-semibold uppercase tracking-[0.1em]"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            <span aria-hidden>🔥</span>
            Your focus now
          </div>

          <h1 className="mx-auto mt-4 max-w-[520px] text-[1.8rem] font-bold leading-[1.2] tracking-[-0.025em]">
            {focusTitle}
          </h1>
          <p className="mt-2 text-[0.96rem]" style={{ color: "var(--text-2)" }}>
            {focusMeta}
          </p>

          <div className="mt-6">
            <div
              className="text-[3.2rem] font-bold leading-none tracking-[-0.04em] tabular-nums"
              style={{ color: isComplete ? "var(--done)" : "var(--text)" }}
            >
              {formatClock(displayRemainingSeconds)}
            </div>
            <p className="mt-2 text-[0.88rem]" style={{ color: "var(--text-2)" }}>
              {isComplete
                ? "Session complete — wrap up and reflect"
                : isRunning
                  ? activeTask
                    ? `Working on: ${activeTask.name}`
                    : "Pick the task you'll work on"
                  : "Press Start Focus when you're ready"}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
            {!isComplete ? (
              isRunning ? (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void updateTimerState("pause")}
                  className="inline-flex h-12 items-center gap-2 rounded-[12px] px-6 text-[0.94rem] font-semibold"
                  style={{
                    background: "var(--surface-solid)",
                    border: "1px solid var(--line)",
                    color: "var(--text)",
                    opacity: isSaving ? 0.6 : 1,
                  }}
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void updateTimerState("resume")}
                  className="inline-flex h-12 items-center gap-2 rounded-[12px] px-7 text-[0.94rem] font-semibold text-white"
                  style={{
                    background: "var(--accent)",
                    boxShadow: "0 6px 18px rgba(0,122,255,0.28)",
                    opacity: isSaving ? 0.6 : 1,
                  }}
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                    <path d="M5 3.5v9a.5.5 0 0 0 .76.43l7.5-4.5a.5.5 0 0 0 0-.86l-7.5-4.5A.5.5 0 0 0 5 3.5z" />
                  </svg>
                  Start Focus
                </button>
              )
            ) : null}

            {activeTask ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleMarkDone(activeTask)}
                className="h-12 rounded-[12px] px-6 text-[0.94rem] font-semibold text-white"
                style={{
                  background: "var(--done)",
                  boxShadow: "0 6px 18px rgba(52,199,89,0.24)",
                  opacity: isSaving ? 0.6 : 1,
                }}
              >
                Mark Done
              </button>
            ) : null}

            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleEndBlock()}
              className="h-12 rounded-[12px] border px-6 text-[0.94rem] font-semibold"
              style={{
                background: "transparent",
                borderColor: "var(--line)",
                color: "var(--text-2)",
                opacity: isSaving ? 0.6 : 1,
              }}
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
        </section>

        <section className="anim anim-d2 mx-auto mt-8 max-w-[520px] text-left">
          <h2
            className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.04em]"
            style={{ color: "var(--text-3)" }}
          >
            Tasks in this block
          </h2>
          {tasks.length === 0 ? (
            <p className="py-2 text-[0.86rem]" style={{ color: "var(--text-2)" }}>
              No tasks linked to this block yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {tasks.map((task) => {
                const isActive = block.activeTaskId === task.id;
                const isDone = task.status === "done";
                return (
                  <li
                    key={task.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                    style={{ borderBottomColor: "var(--line)" }}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden
                        className="grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full"
                        style={{
                          border: isDone
                            ? "none"
                            : `2px solid ${isActive ? "var(--warn)" : "var(--text-3)"}`,
                          background: isDone
                            ? "var(--done)"
                            : isActive
                              ? "var(--warn)"
                              : "transparent",
                          boxShadow: isActive ? "0 0 0 4px rgba(255,149,0,0.15)" : "none",
                        }}
                      >
                        {isDone ? (
                          <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 fill-white">
                            <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
                          </svg>
                        ) : null}
                      </span>
                      <p
                        className="truncate text-[0.92rem]"
                        style={{
                          color: isDone ? "var(--text-3)" : "var(--text)",
                          textDecoration: isDone ? "line-through" : "none",
                          fontWeight: isActive ? 600 : 400,
                        }}
                      >
                        {task.name}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 gap-1.5">
                      {isActive ? (
                        <span
                          className="inline-flex h-7 items-center rounded-[8px] px-2.5 text-[0.74rem] font-semibold"
                          style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
                        >
                          Active
                        </span>
                      ) : !isDone ? (
                        <button
                          type="button"
                          onClick={() => void setActiveTask(task.id)}
                          className="h-7 rounded-[8px] border px-2.5 text-[0.74rem] font-medium"
                          style={{
                            borderColor: "var(--line)",
                            background: "transparent",
                            color: "var(--text-2)",
                          }}
                          disabled={isSaving}
                        >
                          Set active
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
