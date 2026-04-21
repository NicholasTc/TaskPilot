"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Task } from "@/types/task";
import { NextActionBanner } from "@/components/layout/next-action-banner";
import { AutoPlanError, runAutoPlan } from "@/lib/plan-client";

type BlockStatus = "planned" | "active" | "done";
type BoardStatus = "backlog" | "planned" | "in_progress" | "done";

type StudyBlock = {
  id: string;
  dayKey: string;
  title: string;
  startMinutes: number;
  durationMin: number;
  status: BlockStatus;
  activeTaskId: string | null;
  timerState?: "paused" | "running";
  remainingSeconds?: number;
  effectiveRemainingSeconds?: number;
  runningSince?: string | null;
  /** Planner's explanation of why this block was placed here. */
  reason?: string;
};

type BoardTask = Task & {
  status: BoardStatus;
  dayKey: string | null;
  order: number;
  studyBlockId: string | null;
};

const boardStatuses: BoardStatus[] = ["backlog", "planned", "in_progress", "done"];

function toLocalDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
  }).format(date);
}

function toHumanTimeShort(startMinutes: number) {
  const hour12 = ((Math.floor(startMinutes / 60) + 11) % 12) + 1;
  const minutes = startMinutes % 60;
  return `${hour12}:${String(minutes).padStart(2, "0")}`;
}

function toHumanTime(startMinutes: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(1970, 0, 1, Math.floor(startMinutes / 60), startMinutes % 60));
}

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remSeconds = safeSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remSeconds).padStart(2, "0")}`;
}

function normalizeTask(task: Task): BoardTask {
  const status = task.status ?? (task.completed ? "done" : "backlog");
  return {
    ...task,
    status,
    dayKey: task.dayKey ?? null,
    order: task.order ?? 0,
    studyBlockId: task.studyBlockId ?? null,
  };
}

function formatDurationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export default function BlocksPage() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [blocks, setBlocks] = useState<StudyBlock[]>([]);
  const [tasksByStatus, setTasksByStatus] = useState<Record<BoardStatus, BoardTask[]>>({
    backlog: [],
    planned: [],
    in_progress: [],
    done: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingTimer, setIsUpdatingTimer] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isPlanning, setIsPlanning] = useState(false);
  const [skippingBlockId, setSkippingBlockId] = useState<string | null>(null);

  const dayKey = useMemo(() => toLocalDayKey(selectedDate), [selectedDate]);
  const dateLabel = useMemo(() => formatDateLabel(selectedDate), [selectedDate]);

  const activeBlock = useMemo(
    () => blocks.find((block) => block.status === "active") ?? null,
    [blocks],
  );

  const activeBlockRemainingSeconds = useMemo(() => {
    if (!activeBlock) return 0;

    const baseRemaining =
      activeBlock.effectiveRemainingSeconds ?? activeBlock.remainingSeconds ?? activeBlock.durationMin * 60;

    if (activeBlock.timerState !== "running" || !activeBlock.runningSince) {
      return Math.max(0, Math.floor(baseRemaining));
    }

    const runningSinceMs = new Date(activeBlock.runningSince).getTime();
    const elapsedSeconds = Math.floor((nowMs - runningSinceMs) / 1000);
    const fallbackRemaining = activeBlock.remainingSeconds ?? baseRemaining;
    return Math.max(0, Math.floor(fallbackRemaining) - elapsedSeconds);
  }, [activeBlock, nowMs]);

  const allTasksForDay = useMemo(
    () => boardStatuses.flatMap((status) => tasksByStatus[status]).filter((task) => task.dayKey === dayKey),
    [dayKey, tasksByStatus],
  );

  const redirectToLogin = useCallback(() => {
    router.replace("/login");
  }, [router]);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const [blocksResponse, boardResponse] = await Promise.all([
        fetch(`/api/blocks?day=${dayKey}`),
        fetch(`/api/board?day=${dayKey}`),
      ]);

      if (blocksResponse.status === 401 || boardResponse.status === 401) {
        redirectToLogin();
        return;
      }

      if (!blocksResponse.ok || !boardResponse.ok) {
        throw new Error("Failed to load blocks data.");
      }

      const blocksPayload = (await blocksResponse.json()) as { blocks: StudyBlock[] };
      const boardPayload = (await boardResponse.json()) as {
        tasksByStatus: Record<BoardStatus, Task[]>;
      };

      setBlocks(
        [...(blocksPayload.blocks ?? [])].sort(
          (a, b) => a.startMinutes - b.startMinutes || a.durationMin - b.durationMin,
        ),
      );

      setTasksByStatus({
        backlog: (boardPayload.tasksByStatus.backlog ?? []).map(normalizeTask),
        planned: (boardPayload.tasksByStatus.planned ?? []).map(normalizeTask),
        in_progress: (boardPayload.tasksByStatus.in_progress ?? []).map(normalizeTask),
        done: (boardPayload.tasksByStatus.done ?? []).map(normalizeTask),
      });
    } catch (error) {
      console.error("Loading blocks page failed", error);
      setErrorMessage("Could not load blocks. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [dayKey, redirectToLogin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(null), 2800);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  useEffect(() => {
    if (!activeBlock || activeBlock.timerState !== "running") return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeBlock]);

  useEffect(() => {
    if (!activeBlock || activeBlock.timerState !== "running") return;
    const interval = window.setInterval(() => {
      void loadData();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [activeBlock, loadData]);

  /**
   * Run the auto-planner from here — used by both the "Re-plan" header action
   * and the empty-state CTA. Preserves active/done blocks, replaces the rest.
   */
  const handleReplan = useCallback(async () => {
    if (isPlanning) return;
    setIsPlanning(true);
    setErrorMessage(null);
    try {
      await runAutoPlan();
      await loadData();
      setSuccessMessage("Schedule updated.");
    } catch (error) {
      console.error("Re-plan failed", error);
      if (error instanceof AutoPlanError && error.status === 401) {
        redirectToLogin();
        return;
      }
      const message =
        error instanceof AutoPlanError
          ? error.message
          : "Could not re-plan the schedule.";
      setErrorMessage(message);
    } finally {
      setIsPlanning(false);
    }
  }, [isPlanning, loadData, redirectToLogin]);

  /**
   * Skip-this-block is our one targeted manual override: delete the block
   * and immediately re-run the planner so its task gets rescheduled
   * somewhere else (or marked unscheduled if nothing fits).
   */
  const handleSkipBlock = useCallback(
    async (blockId: string) => {
      if (skippingBlockId) return;
      setSkippingBlockId(blockId);
      setErrorMessage(null);
      try {
        const deleteResponse = await fetch(`/api/blocks/${blockId}`, {
          method: "DELETE",
        });
        if (deleteResponse.status === 401) {
          redirectToLogin();
          return;
        }
        if (!deleteResponse.ok) throw new Error("Unable to delete block");

        await runAutoPlan();
        await loadData();
        setSuccessMessage("Block skipped and schedule refreshed.");
      } catch (error) {
        console.error("Skip block failed", error);
        if (error instanceof AutoPlanError && error.status === 401) {
          redirectToLogin();
          return;
        }
        const message =
          error instanceof AutoPlanError
            ? error.message
            : "Could not skip this block.";
        setErrorMessage(message);
      } finally {
        setSkippingBlockId(null);
      }
    },
    [loadData, redirectToLogin, skippingBlockId],
  );

  const handleStartBlock = async (blockId: string) => {
    try {
      setErrorMessage(null);
      const response = await fetch(`/api/blocks/${blockId}/start`, { method: "POST" });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error("Unable to start block");
      await loadData();
      setSuccessMessage("Block started.");
    } catch (error) {
      console.error("Starting block failed", error);
      setErrorMessage("Could not start block.");
    }
  };

  const handleEndBlock = async (blockId: string) => {
    try {
      setErrorMessage(null);
      const response = await fetch(`/api/blocks/${blockId}/end`, { method: "POST" });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error("Unable to end block");
      await loadData();
      setSuccessMessage("Block ended.");
    } catch (error) {
      console.error("Ending block failed", error);
      setErrorMessage("Could not end block.");
    }
  };

  const handleTogglePauseBlock = async (blockId: string, nextAction: "pause" | "resume") => {
    try {
      setIsUpdatingTimer(true);
      setErrorMessage(null);
      const response = await fetch(`/api/blocks/${blockId}/focus/timer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: nextAction }),
      });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) {
        throw new Error("Unable to update timer state");
      }
      await loadData();
      setSuccessMessage(nextAction === "pause" ? "Block paused." : "Block resumed.");
    } catch (error) {
      console.error("Toggling block pause failed", error);
      setErrorMessage("Could not update block timer state.");
    } finally {
      setIsUpdatingTimer(false);
    }
  };

  const getBlockTasks = (blockId: string) =>
    allTasksForDay
      .filter((task) => task.studyBlockId === blockId)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const totalBlocksToday = blocks.length;
  const activeBlockIndex = activeBlock
    ? blocks.findIndex((block) => block.id === activeBlock.id) + 1
    : 0;

  const plannedCount = blocks.filter((b) => b.status === "planned").length;
  const doneCount = blocks.filter((b) => b.status === "done").length;

  const blockBanner =
    blocks.length === 0
      ? {
          eyebrow: "Step 2 · Schedule",
          title: "No schedule yet — let the planner build one.",
          description:
            "Click Plan my day and TaskPilot will turn your open tasks into focus blocks based on priority, due date, and estimated time.",
          tone: "accent" as const,
          action: "plan" as const,
        }
      : activeBlock
        ? {
            eyebrow: "Step 2 · Schedule · Running",
            title: `${activeBlock.title} is live.`,
            description: "Open focus mode to stay on the task.",
            tone: "accent" as const,
            action: "focus" as const,
          }
        : doneCount === totalBlocksToday
          ? {
              eyebrow: "Step 2 · Schedule · Complete",
              title: "Every block is done. Time to reflect.",
              description: "Head to Reflect for a quick recap of today.",
              tone: "done" as const,
              action: "reflect" as const,
            }
          : {
              eyebrow: "Step 2 · Schedule",
              title: `Start your first of ${plannedCount} planned block${plannedCount === 1 ? "" : "s"}.`,
              description:
                "TaskPilot scheduled these automatically. Start when you're ready, or re-plan if things changed.",
              tone: "accent" as const,
              action: "none" as const,
            };

  return (
    <div className="mx-auto w-full max-w-[1040px]">
      <NextActionBanner
        step={2}
        eyebrow={blockBanner.eyebrow}
        title={blockBanner.title}
        description={blockBanner.description}
        tone={blockBanner.tone}
        ctaLabel={
          blockBanner.action === "plan"
            ? isPlanning
              ? "Planning..."
              : "Plan my day"
            : blockBanner.action === "focus" && activeBlock
              ? "Open focus mode"
              : blockBanner.action === "reflect"
                ? "Open Reflect"
                : undefined
        }
        ctaHref={
          blockBanner.action === "focus" && activeBlock
            ? `/blocks/${activeBlock.id}/focus`
            : blockBanner.action === "reflect"
              ? "/today"
              : undefined
        }
        onCtaClick={blockBanner.action === "plan" ? handleReplan : undefined}
        ctaDisabled={blockBanner.action === "plan" && isPlanning}
      />
      <header className="anim mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.85rem] font-bold leading-[1.1] tracking-[-0.03em]">Study Blocks</h1>
          <p className="mt-1.5 text-[0.95rem]" style={{ color: "var(--text-2)" }}>
            Auto-scheduled from your tasks. Start, re-plan, or skip a block you don&apos;t need.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {blocks.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleReplan()}
              disabled={isPlanning}
              className="h-9 rounded-[10px] border px-4 text-[0.84rem] font-medium transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55"
              style={{
                borderColor: "var(--line)",
                background: "var(--surface-solid)",
                color: "var(--text-2)",
              }}
            >
              {isPlanning ? "Re-planning..." : "Re-plan"}
            </button>
          ) : null}
          <div
            className="flex items-center gap-1 rounded-[12px] border p-1"
            style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
          >
            <button
              type="button"
              onClick={() => setSelectedDate((current) => addDays(current, -1))}
              className="grid h-8 w-8 place-items-center rounded-[8px] text-[var(--text-2)] transition-[background,color] duration-200 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              aria-label="Previous day"
            >
              <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 12 6 8l4-4" />
              </svg>
            </button>
            <div className="px-3.5 text-[0.88rem] font-semibold">{dateLabel}</div>
            <button
              type="button"
              onClick={() => setSelectedDate((current) => addDays(current, 1))}
              className="grid h-8 w-8 place-items-center rounded-[8px] text-[var(--text-2)] transition-[background,color] duration-200 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              aria-label="Next day"
            >
              <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 4 4 4-4 4" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {errorMessage ? (
        <p className="mb-4 text-[0.84rem]" style={{ color: "var(--danger)" }}>
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p className="mb-4 text-[0.84rem]" style={{ color: "var(--done)" }}>
          {successMessage}
        </p>
      ) : null}

      {activeBlock ? (
        <section
          className="anim anim-d1 relative mb-8 overflow-hidden rounded-[18px] px-7 py-7 text-white"
          style={{
            background: "linear-gradient(135deg, #007aff, #5856d6)",
            boxShadow: "0 8px 24px rgba(0,122,255,0.25)",
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-[40px] -top-[40px] h-[200px] w-[200px] rounded-full"
            style={{ background: "rgba(255,255,255,0.08)" }}
          />
          <div className="relative">
            <div className="mb-2 inline-flex items-center gap-2 text-[0.78rem] font-semibold uppercase tracking-[0.05em] opacity-80">
              <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-white" />
              Active block{totalBlocksToday > 0 ? ` · ${activeBlockIndex} of ${totalBlocksToday}` : ""}
            </div>
            <h2 className="text-[1.45rem] font-bold tracking-[-0.02em]">{activeBlock.title}</h2>
            <p className="mt-1 text-[0.92rem] opacity-90">
              {toHumanTime(activeBlock.startMinutes)} – {toHumanTime(activeBlock.startMinutes + activeBlock.durationMin)} · {formatDurationLabel(activeBlock.durationMin)}
            </p>

            <div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-6 max-[640px]:grid-cols-1 max-[640px]:items-start">
              <div className="flex flex-col gap-2 text-[0.92rem]">
                {getBlockTasks(activeBlock.id).length === 0 ? (
                  <p className="opacity-85">No tasks linked to this block yet.</p>
                ) : (
                  getBlockTasks(activeBlock.id)
                    .slice(0, 3)
                    .map((task) => (
                      <div key={task.id} className="flex items-center gap-2.5">
                        <span
                          className="grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full border-2"
                          style={{
                            borderColor: task.completed ? "#fff" : "rgba(255,255,255,0.5)",
                            background: task.completed ? "#fff" : "transparent",
                          }}
                        >
                          {task.completed ? (
                            <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="var(--accent)">
                              <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
                            </svg>
                          ) : null}
                        </span>
                        <span
                          style={{
                            opacity: task.completed ? 0.65 : 1,
                            textDecoration: task.completed ? "line-through" : "none",
                          }}
                        >
                          {task.name}
                        </span>
                      </div>
                    ))
                )}
              </div>
              <div className="text-right max-[640px]:text-left">
                <div className="text-[2.4rem] font-bold leading-none tracking-[-0.04em] tabular-nums">
                  {formatClock(activeBlockRemainingSeconds)}
                </div>
                <div className="mt-1 text-[0.8rem] opacity-80">
                  {activeBlock.timerState === "running" ? "running" : "paused"} · time remaining
                </div>
              </div>
            </div>

            <div className="relative mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => router.push(`/blocks/${activeBlock.id}/focus`)}
                className="h-[38px] rounded-[10px] px-4 text-[0.86rem] font-semibold"
                style={{ background: "#fff", color: "var(--accent)" }}
              >
                Open focus mode
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleTogglePauseBlock(
                    activeBlock.id,
                    activeBlock.timerState === "running" ? "pause" : "resume",
                  )
                }
                disabled={isUpdatingTimer || activeBlockRemainingSeconds <= 0}
                className="h-[32px] rounded-[8px] px-3 text-[0.8rem] font-medium text-white"
                style={{
                  background: "rgba(255,255,255,0.16)",
                  opacity: isUpdatingTimer || activeBlockRemainingSeconds <= 0 ? 0.55 : 1,
                }}
              >
                {activeBlock.timerState === "running" ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                onClick={() => handleEndBlock(activeBlock.id)}
                className="h-[32px] rounded-[8px] px-3 text-[0.8rem] font-medium text-white"
                style={{ background: "rgba(255,255,255,0.16)" }}
              >
                End block
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <h3
        className="anim anim-d2 mb-3 text-[0.78rem] font-semibold uppercase tracking-[0.04em]"
        style={{ color: "var(--text-3)" }}
      >
        Today&apos;s schedule
      </h3>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((skeleton) => (
            <div
              key={skeleton}
              className="h-[120px] animate-pulse rounded-[16px] border"
              style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
            />
          ))}
        </div>
      ) : blocks.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-[16px] border px-4 py-10 text-center"
          style={{ borderColor: "var(--line-strong)", borderStyle: "dashed" }}
        >
          <p className="text-[0.92rem] font-medium" style={{ color: "var(--text-2)" }}>
            No schedule for this day yet.
          </p>
          <p className="text-[0.82rem]" style={{ color: "var(--text-3)" }}>
            TaskPilot will pick times based on priority, due date, and estimated time.
          </p>
          <button
            type="button"
            onClick={() => void handleReplan()}
            disabled={isPlanning}
            className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-[10px] px-5 text-[0.88rem] font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
            style={{ background: "var(--accent)" }}
          >
            {isPlanning ? "Planning..." : "Plan my day"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {blocks.map((block, index) => {
            const blockTasks = getBlockTasks(block.id);
            const animClass = `anim anim-d${Math.min(4, index + 1)}`;
            const isSkipping = skippingBlockId === block.id;
            const statusLabel =
              block.status === "active" ? "Active" : block.status === "done" ? "Done" : "Upcoming";
            const statusBg =
              block.status === "active"
                ? "var(--warn-soft)"
                : block.status === "done"
                  ? "var(--done-soft)"
                  : "var(--accent-soft)";
            const statusColor =
              block.status === "active"
                ? "var(--warn)"
                : block.status === "done"
                  ? "var(--done)"
                  : "var(--accent)";

            return (
              <article
                key={block.id}
                className={`${animClass} rounded-[16px] border px-5 py-5 transition-[box-shadow,border-color] duration-200 hover:border-[var(--line-strong)]`}
                style={{
                  background: "var(--surface-solid)",
                  borderColor: "var(--line)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-5 max-[700px]:grid-cols-1 max-[700px]:gap-3">
                  <div
                    className="min-w-[88px] border-r pr-5 text-center max-[700px]:border-r-0 max-[700px]:pr-0 max-[700px]:text-left"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <div className="text-[1.4rem] font-bold leading-none tracking-[-0.02em] tabular-nums">
                      {toHumanTimeShort(block.startMinutes)}
                    </div>
                    <div className="mt-1 text-[0.78rem]" style={{ color: "var(--text-3)" }}>
                      – {toHumanTime(block.startMinutes + block.durationMin)}
                    </div>
                    <div
                      className="mt-1.5 inline-block rounded-full px-2 py-[2px] text-[0.72rem] font-semibold"
                      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                    >
                      {formatDurationLabel(block.durationMin)}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <h4 className="text-[1.05rem] font-semibold tracking-[-0.01em]">{block.title}</h4>
                    {block.reason ? (
                      <p
                        className="mt-1 text-[0.76rem] italic"
                        style={{ color: "var(--text-3)" }}
                      >
                        Why: {block.reason}
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-[0.82rem]" style={{ color: "var(--text-2)" }}>
                      {blockTasks.length === 0
                        ? "No tasks assigned"
                        : `${blockTasks.length} task${blockTasks.length === 1 ? "" : "s"}`}
                    </p>
                    {blockTasks.length > 0 ? (
                      <div className="mt-2 flex flex-col gap-1">
                        {blockTasks.slice(0, 3).map((task) => (
                          <div key={task.id} className="flex items-center gap-2 text-[0.85rem]" style={{ color: "var(--text-2)" }}>
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{
                                background:
                                  task.status === "done"
                                    ? "var(--done)"
                                    : task.status === "in_progress"
                                      ? "var(--warn)"
                                      : "var(--text-3)",
                              }}
                            />
                            <span
                              style={{
                                textDecoration: task.completed ? "line-through" : "none",
                                opacity: task.completed ? 0.6 : 1,
                              }}
                            >
                              {task.name}
                            </span>
                          </div>
                        ))}
                        {blockTasks.length > 3 ? (
                          <span className="text-[0.78rem]" style={{ color: "var(--text-3)" }}>
                            +{blockTasks.length - 3} more
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-end gap-2 max-[700px]:flex-row max-[700px]:items-center max-[700px]:flex-wrap">
                    <span
                      className="rounded-full px-2.5 py-[3px] text-[0.72rem] font-semibold uppercase tracking-[0.04em]"
                      style={{ background: statusBg, color: statusColor }}
                    >
                      {statusLabel}
                    </span>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {block.status === "planned" ? (
                        <button
                          type="button"
                          onClick={() => void handleStartBlock(block.id)}
                          className="h-8 rounded-[8px] px-3 text-[0.78rem] font-semibold text-white"
                          style={{ background: "var(--accent)" }}
                        >
                          Start
                        </button>
                      ) : null}
                      {block.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => router.push(`/blocks/${block.id}/focus`)}
                          className="h-8 rounded-[8px] px-3 text-[0.78rem] font-semibold text-white"
                          style={{ background: "var(--accent)" }}
                        >
                          Open focus
                        </button>
                      ) : null}
                      {block.status !== "done" ? (
                        <button
                          type="button"
                          onClick={() => void handleSkipBlock(block.id)}
                          disabled={isSkipping || isPlanning}
                          title="Delete this block and re-plan the remaining tasks"
                          className="h-8 rounded-[8px] border px-3 text-[0.78rem] font-medium transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-55"
                          style={{
                            borderColor: "var(--line)",
                            background: "var(--surface-solid)",
                            color: "var(--text-2)",
                          }}
                        >
                          {isSkipping ? "Skipping..." : "Skip this block"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

    </div>
  );
}
