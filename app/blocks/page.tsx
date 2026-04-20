"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Task } from "@/types/task";
import { NextActionBanner } from "@/components/layout/next-action-banner";

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
};

type BoardTask = Task & {
  status: BoardStatus;
  dayKey: string | null;
  order: number;
  studyBlockId: string | null;
};

const durationPresets = [60, 90, 120];
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

function toMinutesFromTimeInput(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingAssignments, setIsSavingAssignments] = useState(false);
  const [isUpdatingTimer, setIsUpdatingTimer] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [openAssignBlockId, setOpenAssignBlockId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [isAddBlockOpen, setIsAddBlockOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftStartTime, setDraftStartTime] = useState("10:00");
  const [draftDuration, setDraftDuration] = useState<number>(120);

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

  const assignmentPool = useMemo(
    () => [...tasksByStatus.backlog, ...tasksByStatus.planned].filter((task) => task.dayKey === dayKey),
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

  const handleCreateBlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftTitle.trim() || isSubmitting) return;

    const startMinutes = toMinutesFromTimeInput(draftStartTime);
    if (startMinutes === null) {
      setErrorMessage("Invalid start time.");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const response = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayKey,
          title: draftTitle.trim(),
          startMinutes,
          durationMin: draftDuration,
        }),
      });

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

      if (response.status === 409) {
        const payload = (await response.json()) as { code?: string; error?: string };
        if (payload.code === "BLOCK_OVERLAP") {
          setErrorMessage("This block overlaps another block. Pick a different time.");
          return;
        }
      }

      if (!response.ok) {
        throw new Error("Unable to create block");
      }

      const created = (await response.json()) as StudyBlock;
      setBlocks((prev) =>
        [...prev, created].sort((a, b) => a.startMinutes - b.startMinutes || a.durationMin - b.durationMin),
      );
      setDraftTitle("");
      setIsAddBlockOpen(false);
      setSuccessMessage("Block created.");
    } catch (error) {
      console.error("Creating block failed", error);
      setErrorMessage("Could not create block.");
    } finally {
      setIsSubmitting(false);
    }
  };

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

  const handleDeleteBlock = async (blockId: string) => {
    try {
      setErrorMessage(null);
      const response = await fetch(`/api/blocks/${blockId}`, { method: "DELETE" });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error("Unable to delete block");

      const linkedTasks = allTasksForDay.filter((task) => task.studyBlockId === blockId);
      await Promise.all(
        linkedTasks.map((task) =>
          fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studyBlockId: null }),
          }),
        ),
      );

      await loadData();
      setSuccessMessage("Block deleted.");
    } catch (error) {
      console.error("Deleting block failed", error);
      setErrorMessage("Could not delete block.");
    }
  };

  const openAssignPanel = (block: StudyBlock) => {
    setOpenAssignBlockId(block.id);
    const initiallySelected = assignmentPool
      .filter((task) => task.studyBlockId === block.id)
      .map((task) => task.id);
    setSelectedTaskIds(initiallySelected);
  };

  const handleSaveAssignments = async (blockId: string) => {
    try {
      setIsSavingAssignments(true);
      setErrorMessage(null);
      const existingAssignments = assignmentPool.filter((task) => task.studyBlockId === blockId);
      const existingIds = new Set(existingAssignments.map((task) => task.id));
      const nextIds = new Set(selectedTaskIds);

      const toAssign = assignmentPool.filter((task) => nextIds.has(task.id) && task.studyBlockId !== blockId);
      const toUnassign = assignmentPool.filter((task) => existingIds.has(task.id) && !nextIds.has(task.id));

      await Promise.all([
        ...toAssign.map((task) =>
          fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studyBlockId: blockId }),
          }),
        ),
        ...toUnassign.map((task) =>
          fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studyBlockId: null }),
          }),
        ),
      ]);

      setOpenAssignBlockId(null);
      setSelectedTaskIds([]);
      await loadData();
      setSuccessMessage("Block tasks updated.");
    } catch (error) {
      console.error("Saving assignments failed", error);
      setErrorMessage("Could not save task assignments.");
    } finally {
      setIsSavingAssignments(false);
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

  const plannedNotCommitted = allTasksForDay.filter(
    (task) =>
      task.status !== "done" &&
      ["planned", "in_progress"].includes(task.status) &&
      !task.studyBlockId,
  ).length;
  const committedTasksCount = allTasksForDay.filter((task) => !!task.studyBlockId).length;
  const blockBanner =
    blocks.length === 0
      ? {
          eyebrow: "Step 2 · Commit",
          title: "Create your first time block.",
          description: "Pick a 60–120 minute window and assign one or two planned tasks to it.",
          tone: "accent" as const,
          cta: undefined as { label: string; href: string } | undefined,
        }
      : plannedNotCommitted > 0
        ? {
            eyebrow: "Step 2 · Commit",
            title: `Assign ${plannedNotCommitted} planned task${plannedNotCommitted === 1 ? "" : "s"} to a block.`,
            description: "Tap Assign on a block to commit each task to a time window.",
            tone: "accent" as const,
            cta: undefined,
          }
        : committedTasksCount > 0
          ? {
              eyebrow: "Step 2 · Commit · Ready",
              title: "All planned tasks are committed.",
              description: "Head to Home to start your focus block.",
              tone: "done" as const,
              cta: { label: "Go to Home", href: "/" },
            }
          : {
              eyebrow: "Step 2 · Commit",
              title: "Plan some tasks first.",
              description: "Move tasks into Planned on the Board, then assign them here.",
              tone: "neutral" as const,
              cta: { label: "Open Board", href: "/board" },
            };

  return (
    <div className="mx-auto w-full max-w-[1040px]">
      <NextActionBanner
        step={2}
        eyebrow={blockBanner.eyebrow}
        title={blockBanner.title}
        description={blockBanner.description}
        tone={blockBanner.tone}
        ctaLabel={blockBanner.cta?.label}
        ctaHref={blockBanner.cta?.href}
      />
      <header className="anim mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.85rem] font-bold leading-[1.1] tracking-[-0.03em]">Study Blocks</h1>
          <p className="mt-1.5 text-[0.95rem]" style={{ color: "var(--text-2)" }}>
            Commit each planned task to a time window.
          </p>
        </div>
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
          className="rounded-[16px] border px-4 py-8 text-center text-[0.86rem]"
          style={{ borderColor: "var(--line-strong)", borderStyle: "dashed", color: "var(--text-3)" }}
        >
          No blocks planned for this day.
        </div>
      ) : (
        <div className="space-y-3">
          {blocks.map((block, index) => {
            const blockTasks = getBlockTasks(block.id);
            const isAssignOpen = openAssignBlockId === block.id;
            const animClass = `anim anim-d${Math.min(4, index + 1)}`;
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
                          onClick={() => (isAssignOpen ? setOpenAssignBlockId(null) : openAssignPanel(block))}
                          className="h-8 rounded-[8px] border px-3 text-[0.78rem] font-medium"
                          style={{
                            borderColor: "var(--line)",
                            background: "var(--surface-solid)",
                            color: "var(--text-2)",
                          }}
                        >
                          {isAssignOpen ? "Close" : "Assign"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleDeleteBlock(block.id)}
                        aria-label="Delete block"
                        title="Delete block"
                        className="grid h-8 w-8 place-items-center rounded-[8px] border text-[var(--text-3)] hover:text-[var(--danger)]"
                        style={{ borderColor: "var(--line)" }}
                      >
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6zM14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3h11V2h-11v1z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {isAssignOpen ? (
                  <div
                    className="mt-4 rounded-[12px] border px-3.5 py-3"
                    style={{ background: "var(--surface-hover)", borderColor: "var(--line)" }}
                  >
                    <p className="mb-2 text-[0.74rem] font-semibold uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>
                      Assign from Backlog + Planned
                    </p>
                    {assignmentPool.length === 0 ? (
                      <p className="text-[0.82rem]" style={{ color: "var(--text-2)" }}>
                        No eligible tasks. Add tasks in Backlog/Planned on the Board.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {assignmentPool.map((task) => (
                          <label
                            key={task.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[0.84rem] hover:bg-[var(--surface-solid)]"
                          >
                            <input
                              type="checkbox"
                              checked={selectedTaskIds.includes(task.id)}
                              onChange={(event) => {
                                setSelectedTaskIds((prev) =>
                                  event.target.checked
                                    ? [...prev, task.id]
                                    : prev.filter((itemId) => itemId !== task.id),
                                );
                              }}
                              className="accent-[var(--accent)]"
                            />
                            <span>{task.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveAssignments(block.id)}
                        disabled={isSavingAssignments}
                        className="h-8 rounded-[8px] px-3 text-[0.78rem] font-semibold text-white"
                        style={{ background: "var(--accent)", opacity: isSavingAssignments ? 0.65 : 1 }}
                      >
                        {isSavingAssignments ? "Saving..." : "Save assignments"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenAssignBlockId(null);
                          setSelectedTaskIds([]);
                        }}
                        className="h-8 rounded-[8px] border px-3 text-[0.78rem] font-medium"
                        style={{ borderColor: "var(--line)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {isAddBlockOpen ? (
        <section
          className="anim mt-4 rounded-[16px] border px-5 py-5"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
        >
          <form className="space-y-3" onSubmit={handleCreateBlock}>
            <div>
              <label className="mb-1 block text-[0.74rem] font-semibold uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>
                Block name
              </label>
              <input
                autoFocus
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="e.g. TypeScript Deep Work"
                className="h-10 w-full rounded-[10px] border px-3.5 text-[0.9rem] outline-none focus:border-[var(--accent)]"
                style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
              />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-[0.74rem] font-semibold uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>
                  Start
                </label>
                <input
                  type="time"
                  value={draftStartTime}
                  onChange={(event) => setDraftStartTime(event.target.value)}
                  className="h-10 rounded-[10px] border px-3 text-[0.86rem] outline-none focus:border-[var(--accent)]"
                  style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
                />
              </div>
              <div>
                <label className="mb-1 block text-[0.74rem] font-semibold uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>
                  Duration
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {durationPresets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setDraftDuration(preset)}
                      className="h-9 rounded-[8px] px-3 text-[0.8rem] font-semibold transition-colors"
                      style={{
                        background: draftDuration === preset ? "var(--accent-soft)" : "var(--surface-hover)",
                        color: draftDuration === preset ? "var(--accent)" : "var(--text-2)",
                      }}
                    >
                      {preset}m
                    </button>
                  ))}
                  <input
                    type="number"
                    min={15}
                    max={720}
                    value={draftDuration}
                    onChange={(event) => setDraftDuration(Number(event.target.value))}
                    className="h-9 w-[90px] rounded-[8px] border px-2.5 text-[0.8rem] outline-none focus:border-[var(--accent)]"
                    style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
                    aria-label="Custom duration in minutes"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-10 rounded-[10px] px-4 text-[0.86rem] font-semibold text-white"
                  style={{ background: "var(--accent)", opacity: isSubmitting ? 0.65 : 1 }}
                >
                  {isSubmitting ? "Creating..." : "Create block"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddBlockOpen(false)}
                  className="h-10 rounded-[10px] border px-4 text-[0.86rem] font-medium"
                  style={{ borderColor: "var(--line)", color: "var(--text-2)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setIsAddBlockOpen(true)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-[16px] border-[1.5px] px-4 py-[18px] text-[0.92rem] font-medium transition-[border-color,color] duration-200 hover:border-[var(--accent)] hover:text-[var(--accent)]"
          style={{ borderColor: "var(--line-strong)", borderStyle: "dashed", color: "var(--text-2)" }}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
            <path d="M8 3a.5.5 0 0 1 .5.5v4h4a.5.5 0 0 1 0 1h-4v4a.5.5 0 0 1-1 0v-4h-4a.5.5 0 0 1 0-1h4v-4A.5.5 0 0 1 8 3z" />
          </svg>
          Add new block
        </button>
      )}
    </div>
  );
}
