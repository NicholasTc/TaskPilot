"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Task } from "@/types/task";

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
    month: "short",
    day: "numeric",
  }).format(date);
}

function toTimeInputValue(startMinutes: number) {
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.9rem] font-bold leading-[1.1] tracking-[-0.03em]">Study Blocks</h1>
          <p className="mt-1.5 text-[0.92rem]" style={{ color: "var(--text-2)" }}>
            Two hours of focused, single-task work. No multitasking.
          </p>
        </div>
        <div
          className="flex items-center gap-1 rounded-[12px] border p-1"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
        >
          <button
            type="button"
            onClick={() => setSelectedDate((current) => addDays(current, -1))}
            className="grid h-8 w-8 place-items-center rounded-[8px] transition hover:bg-[var(--surface-hover)]"
            aria-label="Previous day"
          >
            <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" style={{ stroke: "currentColor" }}>
              <path d="M10 12 6 8l4-4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="px-2 text-[0.86rem] font-semibold">{dateLabel}</div>
          <button
            type="button"
            onClick={() => setSelectedDate((current) => addDays(current, 1))}
            className="grid h-8 w-8 place-items-center rounded-[8px] transition hover:bg-[var(--surface-hover)]"
            aria-label="Next day"
          >
            <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" style={{ stroke: "currentColor" }}>
              <path d="m6 4 4 4-4 4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
          className="mb-6 rounded-[18px] border px-6 py-6 text-white shadow-[0_8px_24px_rgba(0,122,255,0.2)]"
          style={{
            background: "linear-gradient(135deg, #007aff, #5856d6)",
            borderColor: "transparent",
          }}
        >
          <p className="text-[0.75rem] font-semibold uppercase tracking-[0.05em] opacity-85">Active block</p>
          <h2 className="mt-1 text-[1.42rem] font-bold tracking-[-0.02em]">{activeBlock.title}</h2>
          <p className="mt-1 text-[0.9rem] opacity-90">
            {toHumanTime(activeBlock.startMinutes)} -{" "}
            {toHumanTime(activeBlock.startMinutes + activeBlock.durationMin)} · {activeBlock.durationMin} min
          </p>
          <p className="mt-2 text-[0.82rem] opacity-90">
            Remaining: {formatClock(activeBlockRemainingSeconds)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void handleTogglePauseBlock(
                  activeBlock.id,
                  activeBlock.timerState === "running" ? "pause" : "resume",
                )
              }
              disabled={isUpdatingTimer || activeBlockRemainingSeconds <= 0}
              className="h-9 rounded-[10px] px-4 text-[0.84rem] font-semibold"
              style={{
                background: "rgba(255,255,255,0.2)",
                color: "#fff",
                opacity: isUpdatingTimer || activeBlockRemainingSeconds <= 0 ? 0.6 : 1,
              }}
            >
              {activeBlock.timerState === "running" ? "Pause" : "Resume"}
            </button>
            <button
              type="button"
              onClick={() => handleEndBlock(activeBlock.id)}
              className="h-9 rounded-[10px] bg-white px-4 text-[0.84rem] font-semibold"
              style={{ color: "var(--accent)" }}
            >
              End block
            </button>
            <button
              type="button"
              onClick={() => router.push(`/blocks/${activeBlock.id}/focus`)}
              className="h-9 rounded-[10px] px-4 text-[0.84rem] font-semibold"
              style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}
            >
              Open focus mode
            </button>
          </div>
        </section>
      ) : null}

      <section
        className="mb-6 rounded-[16px] border px-4 py-4"
        style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
      >
        <form className="space-y-3" onSubmit={handleCreateBlock}>
          <div>
            <label className="mb-1 block text-[0.78rem] font-semibold uppercase tracking-[0.04em] text-[var(--text-3)]">
              New block
            </label>
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="e.g. TypeScript Deep Work"
              className="h-10 w-full rounded-[10px] border px-3.5 text-[0.9rem] outline-none"
              style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-[0.78rem] font-semibold uppercase tracking-[0.04em] text-[var(--text-3)]">
                Start
              </label>
              <input
                type="time"
                value={draftStartTime}
                onChange={(event) => setDraftStartTime(event.target.value)}
                className="h-10 rounded-[10px] border px-3 text-[0.86rem] outline-none"
                style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
              />
            </div>
            <div>
              <label className="mb-1 block text-[0.78rem] font-semibold uppercase tracking-[0.04em] text-[var(--text-3)]">
                Duration
              </label>
              <div className="flex flex-wrap gap-1.5">
                {durationPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDraftDuration(preset)}
                    className="h-8 rounded-[8px] px-2.5 text-[0.78rem] font-semibold"
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
                  className="h-8 w-[88px] rounded-[8px] border px-2 text-[0.78rem] outline-none"
                  style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-10 rounded-[10px] px-4 text-[0.84rem] font-semibold text-white transition active:scale-[0.97]"
              style={{ background: "var(--accent)", opacity: isSubmitting ? 0.65 : 1 }}
            >
              {isSubmitting ? "Creating..." : "Add block"}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h3 className="mb-3 text-[0.78rem] font-semibold uppercase tracking-[0.04em] text-[var(--text-3)]">
          Today&apos;s schedule
        </h3>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((skeleton) => (
              <div
                key={skeleton}
                className="h-[110px] animate-pulse rounded-[14px] border"
                style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
              />
            ))}
          </div>
        ) : blocks.length === 0 ? (
          <div
            className="rounded-[14px] border border-dashed px-4 py-7 text-center text-[0.86rem]"
            style={{ borderColor: "var(--line-strong)", color: "var(--text-3)" }}
          >
            No blocks planned for this day.
          </div>
        ) : (
          <div className="space-y-2.5">
            {blocks.map((block) => {
              const blockTasks = getBlockTasks(block.id);
              const isAssignOpen = openAssignBlockId === block.id;

              return (
                <article
                  key={block.id}
                  className="rounded-[14px] border px-4 py-4"
                  style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[0.78rem] font-semibold uppercase tracking-[0.04em] text-[var(--text-3)]">
                        {toHumanTime(block.startMinutes)} -{" "}
                        {toHumanTime(block.startMinutes + block.durationMin)} · {block.durationMin}m
                      </div>
                      <h4 className="mt-1 text-[1.02rem] font-semibold tracking-[-0.01em]">{block.title}</h4>
                      <p className="mt-1 text-[0.8rem]" style={{ color: "var(--text-2)" }}>
                        {blockTasks.length} task{blockTasks.length === 1 ? "" : "s"} linked
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span
                        className="h-7 rounded-full px-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.03em] leading-[28px]"
                        style={{
                          background:
                            block.status === "active"
                              ? "rgba(255,149,0,0.12)"
                              : block.status === "done"
                                ? "var(--done-soft)"
                                : "var(--accent-soft)",
                          color:
                            block.status === "active"
                              ? "#ff9500"
                              : block.status === "done"
                                ? "var(--done)"
                                : "var(--accent)",
                        }}
                      >
                        {block.status}
                      </span>
                      {block.status !== "active" ? (
                        <button
                          type="button"
                          onClick={() => void handleStartBlock(block.id)}
                          className="h-7 rounded-[8px] px-2.5 text-[0.74rem] font-semibold text-white"
                          style={{ background: "var(--accent)" }}
                        >
                          Start
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleEndBlock(block.id)}
                          className="h-7 rounded-[8px] px-2.5 text-[0.74rem] font-semibold text-white"
                          style={{ background: "var(--done)" }}
                        >
                          End
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => (isAssignOpen ? setOpenAssignBlockId(null) : openAssignPanel(block))}
                        className="h-7 rounded-[8px] border px-2.5 text-[0.74rem] font-semibold"
                        style={{ borderColor: "var(--line)" }}
                      >
                        {isAssignOpen ? "Close assign" : "Assign tasks"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteBlock(block.id)}
                        className="h-7 rounded-[8px] border px-2.5 text-[0.74rem] font-semibold"
                        style={{ borderColor: "var(--line)", color: "var(--danger)" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {blockTasks.length > 0 ? (
                    <div className="mt-3 space-y-1.5">
                      {blockTasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-[0.84rem]"
                          style={{ background: "var(--surface-hover)" }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              background:
                                task.status === "done"
                                  ? "var(--done)"
                                  : task.status === "in_progress"
                                    ? "#ff9500"
                                    : "var(--text-3)",
                            }}
                          />
                          <span>{task.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {isAssignOpen ? (
                    <div
                      className="mt-3 rounded-[10px] border px-3 py-3"
                      style={{ background: "var(--surface-hover)", borderColor: "var(--line)" }}
                    >
                      <p className="mb-2 text-[0.78rem] font-semibold uppercase tracking-[0.04em] text-[var(--text-3)]">
                        Assign from Backlog + Planned
                      </p>
                      {assignmentPool.length === 0 ? (
                        <p className="text-[0.82rem]" style={{ color: "var(--text-2)" }}>
                          No eligible tasks. Add tasks in Backlog/Planned on the Board.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {assignmentPool.map((task) => (
                            <label key={task.id} className="flex items-center gap-2 text-[0.84rem]">
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
                          className="h-8 rounded-[8px] px-3 text-[0.76rem] font-semibold text-white"
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
                          className="h-8 rounded-[8px] border px-3 text-[0.76rem] font-semibold"
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
      </section>
    </div>
  );
}
