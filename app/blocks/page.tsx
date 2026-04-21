"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Task } from "@/types/task";
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

function parseDayKey(dayKey: string | null): Date | null {
  if (!dayKey) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function toHumanTime(startMinutes: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(1970, 0, 1, Math.floor(startMinutes / 60), startMinutes % 60));
}

function formatDurationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
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

function splitMeridiemLabel(timeLabel: string): { clock: string; meridiem: string } {
  const [clock, meridiem] = timeLabel.split(" ");
  return { clock: clock ?? timeLabel, meridiem: meridiem ?? "" };
}

export default function TodayPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedDayKey = searchParams.get("day");
  const [selectedDate, setSelectedDate] = useState(
    () => parseDayKey(requestedDayKey) ?? new Date(),
  );
  const [blocks, setBlocks] = useState<StudyBlock[]>([]);
  const [tasksByStatus, setTasksByStatus] = useState<Record<BoardStatus, BoardTask[]>>({
    backlog: [],
    planned: [],
    in_progress: [],
    done: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isPlanning, setIsPlanning] = useState(false);
  const [skippingBlockId, setSkippingBlockId] = useState<string | null>(null);
  const [isUpdatingTimer, setIsUpdatingTimer] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const dayKey = useMemo(() => toLocalDayKey(selectedDate), [selectedDate]);
  const todayKey = useMemo(() => toLocalDayKey(new Date()), []);
  const isToday = dayKey === todayKey;

  const longDateLabel = useMemo(() => formatLongDate(selectedDate), [selectedDate]);
  const shortDateLabel = useMemo(() => formatShortDate(selectedDate), [selectedDate]);

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
        throw new Error("Failed to load day data.");
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
      console.error("Loading today page failed", error);
      setErrorMessage("Could not load your day. Please try again.");
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
    const timer = window.setTimeout(() => setSuccessMessage(null), 2400);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  const activeBlock = useMemo(
    () => blocks.find((block) => block.status === "active") ?? null,
    [blocks],
  );

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

  const allTasksForDay = useMemo(
    () => boardStatuses.flatMap((status) => tasksByStatus[status]).filter((task) => task.dayKey === dayKey),
    [dayKey, tasksByStatus],
  );

  const getBlockTasks = useCallback(
    (blockId: string) =>
      allTasksForDay
        .filter((task) => task.studyBlockId === blockId)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [allTasksForDay],
  );

  const doneCount = blocks.filter((block) => block.status === "done").length;
  const nextPlannedBlock = blocks.find((block) => block.status === "planned") ?? null;
  const heroBlock = activeBlock ?? nextPlannedBlock;

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

  const focusedMinutes = useMemo(
    () => blocks.filter((block) => block.status === "done").reduce((sum, block) => sum + block.durationMin, 0),
    [blocks],
  );
  const heroStartTime = heroBlock ? toHumanTime(heroBlock.startMinutes) : "";
  const heroEndTime = heroBlock ? toHumanTime(heroBlock.startMinutes + heroBlock.durationMin) : "";
  const heroEndLabel = splitMeridiemLabel(heroEndTime);
  const heroStartLabel = splitMeridiemLabel(heroStartTime);

  const progressPct = blocks.length > 0 ? Math.round((doneCount / blocks.length) * 100) : 0;
  const pageTitle = "Your day";

  const handleReplan = useCallback(async () => {
    if (isPlanning) return;
    setIsPlanning(true);
    setErrorMessage(null);
    try {
      await runAutoPlan();
      await loadData();
      setSuccessMessage("Plan refreshed.");
    } catch (error) {
      console.error("Re-plan failed", error);
      if (error instanceof AutoPlanError && error.status === 401) {
        redirectToLogin();
        return;
      }
      const message =
        error instanceof AutoPlanError ? error.message : "Could not refresh the plan.";
      setErrorMessage(message);
    } finally {
      setIsPlanning(false);
    }
  }, [isPlanning, loadData, redirectToLogin]);

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
        setSuccessMessage("Skipped. Plan updated.");
      } catch (error) {
        console.error("Skip block failed", error);
        if (error instanceof AutoPlanError && error.status === 401) {
          redirectToLogin();
          return;
        }
        const message =
          error instanceof AutoPlanError ? error.message : "Could not skip this block.";
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
      setSuccessMessage("Block finished.");
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
      if (!response.ok) throw new Error("Unable to update timer state");
      await loadData();
      setSuccessMessage(nextAction === "pause" ? "Paused." : "Resumed.");
    } catch (error) {
      console.error("Toggling block pause failed", error);
      setErrorMessage("Could not update timer.");
    } finally {
      setIsUpdatingTimer(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <header className="anim mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p
            className="text-[0.74rem] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--text-3)" }}
          >
            {isToday ? `Today · ${longDateLabel}` : longDateLabel}
          </p>
          <h1 className="mt-1.5 text-[2.1rem] font-bold leading-[1.05] tracking-[-0.035em]">{pageTitle}</h1>
          <p className="mt-1.5 max-w-[500px] text-[0.95rem]" style={{ color: "var(--text-2)" }}>
            {blocks.length > 0
              ? "Start with the next block, or adjust your plan if priorities changed."
              : "Add a few tasks and we will organize your day into focus blocks."}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <div
            className="inline-flex items-center gap-0.5 rounded-full border p-1"
            style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
          >
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => setSelectedDate((current) => addDays(current, -1))}
              className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: "var(--text-2)" }}
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 12 6 8l4-4" />
              </svg>
            </button>
            <span className="px-2.5 text-[0.84rem] font-semibold tabular-nums">{isToday ? "Today" : shortDateLabel}</span>
            <button
              type="button"
              aria-label="Next day"
              onClick={() => setSelectedDate((current) => addDays(current, 1))}
              className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: "var(--text-2)" }}
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 4 4 4-4 4" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            aria-label="Adjust plan"
            onClick={() => void handleReplan()}
            disabled={isPlanning}
            className="grid h-[34px] w-[34px] place-items-center rounded-full border transition-colors hover:text-[var(--accent)] disabled:opacity-60"
            style={{ background: "var(--surface-solid)", borderColor: "var(--line)", color: "var(--text-2)" }}
            title="Adjust plan"
          >
            <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v4h4M13 13V9H9" />
              <path d="M13 7a5 5 0 0 0-9.5-1M3 9a5 5 0 0 0 9.5 1" />
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

      {!isLoading && blocks.length > 0 ? (
        <section className="anim anim-d1 mb-6">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-2 text-[0.84rem]" style={{ color: "var(--text-2)" }}>
              <span>
                <strong style={{ color: "var(--done)" }}>{doneCount}</strong> done
              </span>
              <span style={{ color: "var(--text-3)" }}>·</span>
              <span>
                <strong style={{ color: "var(--accent)" }}>{heroBlock ? 1 : 0}</strong> next
              </span>
              <span style={{ color: "var(--text-3)" }}>·</span>
              <span>
                <strong style={{ color: "var(--text)" }}>{Math.max(0, blocks.length - doneCount)}</strong> remaining
              </span>
            </div>
            <div className="text-[0.84rem] tabular-nums" style={{ color: "var(--text-3)" }}>
              <strong style={{ color: "var(--text)" }}>{progressPct}%</strong> through your day · {focusedMinutes}m focused
            </div>
          </div>
          <div
            className="grid h-2 gap-1"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, blocks.length)}, minmax(0, 1fr))` }}
          >
            {blocks.map((block) => {
              const isNext = heroBlock?.id === block.id && block.status !== "done";
              return (
                <span
                  key={`meter-${block.id}`}
                  className="rounded-full"
                  style={{
                    background:
                      block.status === "done"
                        ? "var(--done)"
                        : isNext
                          ? "var(--accent)"
                          : "var(--line)",
                    boxShadow: isNext ? "0 0 0 3px var(--accent-soft)" : "none",
                  }}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div
          className="anim anim-d2 mb-8 h-[240px] animate-pulse rounded-[18px] border"
          style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
        />
      ) : heroBlock ? (
        <section
          className="anim anim-d2 relative mb-8 grid overflow-hidden rounded-[18px] border"
          style={{
            gridTemplateColumns: "168px 1fr",
            borderColor: "var(--line)",
            background: "var(--surface-solid)",
            boxShadow: "0 10px 30px rgba(0,122,255,0.18)",
          }}
        >
          <aside
            className="relative flex flex-col justify-between overflow-hidden px-[22px] py-6 text-white"
            style={{ background: "linear-gradient(155deg, #007aff, #5856d6)" }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute -right-[50px] -top-[50px] h-[160px] w-[160px] rounded-full"
              style={{ background: "rgba(255,255,255,0.08)" }}
            />
            <div className="relative">
              <p className="inline-flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.08em] opacity-85">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                {activeBlock ? "In progress" : "Next up"}
              </p>
            </div>
            <div className="relative mt-[18px]">
              <p className="whitespace-nowrap text-[2.6rem] font-[800] leading-none tracking-[-0.04em] tabular-nums">
                {activeBlock ? (
                  formatClock(activeBlockRemainingSeconds)
                ) : (
                  <>
                    {heroStartLabel.clock}
                    <small className="ml-1.5 text-[0.95rem] font-semibold opacity-85">{heroStartLabel.meridiem}</small>
                  </>
                )}
              </p>
              <p className="mt-1.5 text-[0.86rem] opacity-90">
                {activeBlock ? (
                  `${heroStartTime} – ${heroEndTime}`
                ) : (
                  <>
                    – {heroEndLabel.clock} {heroEndLabel.meridiem}
                  </>
                )}
              </p>
            </div>
            <span
              className="relative mt-[18px] inline-block self-start rounded-full px-2.5 py-1 text-[0.74rem] font-semibold"
              style={{ background: "rgba(255,255,255,0.18)" }}
            >
              {activeBlock ? formatDurationLabel(heroBlock.durationMin) : `${formatDurationLabel(heroBlock.durationMin)} block`}
            </span>
          </aside>

          <div className="px-7 py-6">
            <h2 className="text-[1.45rem] font-bold leading-[1.2] tracking-[-0.02em]">{heroBlock.title}</h2>
            <p className="mt-1 text-[0.84rem] leading-6" style={{ color: "var(--text-2)" }}>
              {getBlockReason(heroBlock)}
            </p>

            <ul className="mt-4 space-y-2">
              {getBlockTasks(heroBlock.id).length > 0 ? (
                getBlockTasks(heroBlock.id)
                  .slice(0, 3)
                  .map((task) => (
                    <li key={task.id} className="flex items-center gap-2.5 text-[0.92rem]">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--text-3)" }} />
                      <span>{task.name}</span>
                    </li>
                  ))
              ) : (
                <li className="text-[0.9rem]" style={{ color: "var(--text-2)" }}>
                  Flexible block you can use as needed.
                </li>
              )}
            </ul>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              {activeBlock ? (
                <>
                  <button
                    type="button"
                    onClick={() => router.push(`/blocks/${heroBlock.id}/focus`)}
                    className="inline-flex h-[44px] items-center gap-2 rounded-[12px] px-6 text-[0.92rem] font-semibold text-white transition active:scale-[0.98]"
                    style={{ background: "var(--accent)", boxShadow: "0 4px 14px rgba(0,122,255,0.28)" }}
                  >
                    Open focus mode
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleTogglePauseBlock(
                        heroBlock.id,
                        activeBlock.timerState === "running" ? "pause" : "resume",
                      )
                    }
                    disabled={isUpdatingTimer}
                    className="bg-none border-none text-[0.86rem] font-medium"
                    style={{ color: "var(--text-2)" }}
                  >
                    {activeBlock.timerState === "running" ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleEndBlock(heroBlock.id)}
                    className="bg-none border-none text-[0.86rem] font-medium"
                    style={{ color: "var(--text-2)" }}
                  >
                    Finish block
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void handleStartBlock(heroBlock.id)}
                    className="inline-flex h-[44px] items-center gap-2 rounded-[12px] px-6 text-[0.92rem] font-semibold text-white transition active:scale-[0.98]"
                    style={{ background: "var(--accent)", boxShadow: "0 4px 14px rgba(0,122,255,0.28)" }}
                  >
                    Start block
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSkipBlock(heroBlock.id)}
                    disabled={isPlanning || skippingBlockId === heroBlock.id}
                    className="bg-none border-none text-[0.86rem] font-medium disabled:opacity-55"
                    style={{ color: "var(--text-2)" }}
                  >
                    {skippingBlockId === heroBlock.id ? "Skipping…" : "Skip for now"}
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      ) : blocks.length > 0 ? (
        <section
          className="anim anim-d2 mb-8 rounded-[18px] border px-7 py-8 text-center"
          style={{ background: "var(--done-soft)", borderColor: "var(--done)", boxShadow: "var(--shadow-sm)" }}
        >
          <h2 className="text-[1.35rem] font-bold tracking-[-0.02em]">You finished today&apos;s plan.</h2>
          <p className="mt-1.5 text-[0.92rem]" style={{ color: "var(--text-2)" }}>
            Take a beat. Tomorrow can wait until tomorrow.
          </p>
        </section>
      ) : (
        <section
          className="anim anim-d2 mb-8 rounded-[18px] border px-7 py-10 text-center"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line-strong)", borderStyle: "dashed" }}
        >
          <h2 className="text-[1.25rem] font-semibold tracking-[-0.01em]">Nothing planned yet.</h2>
          <p className="mx-auto mt-2 max-w-[420px] text-[0.9rem]" style={{ color: "var(--text-2)" }}>
            Add a few tasks, and we&apos;ll organize them into focus blocks for you.
          </p>
          <button
            type="button"
            onClick={() => void handleReplan()}
            disabled={isPlanning}
            className="mt-5 inline-flex h-[40px] items-center gap-2 rounded-[10px] px-5 text-[0.88rem] font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {isPlanning ? "Planning…" : "Plan my day"}
          </button>
        </section>
      )}

      {!isLoading && blocks.length > 0 ? (
        <section className="anim anim-d3">
          <h3 className="mb-4 text-[0.74rem] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-3)" }}>
            Today&apos;s flow
          </h3>
          <ol className="relative space-y-1">
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-3 left-[79px] top-3 w-px"
              style={{ background: "var(--line)" }}
            />
            {blocks.map((block) => {
              const isDone = block.status === "done";
              const isNext = heroBlock?.id === block.id && !isDone;
              const blockTasks = getBlockTasks(block.id);
              const metaLabel =
                blockTasks.length > 0
                  ? `${blockTasks.length} task${blockTasks.length === 1 ? "" : "s"} · ${formatDurationLabel(block.durationMin)}`
                  : `Flexible block · ${formatDurationLabel(block.durationMin)}`;

              return (
                <li
                  key={block.id}
                  className="grid grid-cols-[72px_16px_1fr] items-center gap-4 py-1.5"
                >
                  <span
                    className="text-right text-[0.84rem] font-semibold tabular-nums"
                    style={{ color: isNext ? "var(--accent)" : isDone ? "var(--text-3)" : "var(--text-2)" }}
                  >
                    {toHumanTime(block.startMinutes)}
                  </span>

                  <span
                    className="relative z-[1] grid h-4 w-4 place-items-center rounded-full"
                    style={{
                      background: isDone ? "var(--done)" : isNext ? "var(--accent)" : "var(--surface-solid)",
                      border: isDone || isNext ? "none" : "2px solid var(--line-strong)",
                      boxShadow: isNext ? "0 0 0 4px var(--accent-soft)" : "none",
                      color: "#fff",
                    }}
                  >
                    {isDone ? (
                      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor">
                        <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
                      </svg>
                    ) : null}
                  </span>

                  <article
                    className="group flex items-center justify-between gap-3 rounded-[14px] border px-4 py-3"
                    style={{
                      background: isDone
                        ? "transparent"
                        : isNext
                          ? "linear-gradient(to right, var(--accent-soft) 0%, var(--surface-solid) 60%)"
                          : "var(--surface-solid)",
                      borderColor: isDone ? "var(--line)" : isNext ? "var(--accent-soft)" : "var(--line)",
                      borderStyle: isDone ? "dashed" : "solid",
                      boxShadow: isDone ? "none" : "var(--shadow-sm)",
                    }}
                  >
                    <div className="min-w-0">
                      <p
                        className="truncate text-[0.94rem] font-semibold"
                        style={{
                          color: isDone ? "var(--text-2)" : "var(--text)",
                          textDecoration: isDone ? "line-through" : "none",
                        }}
                      >
                        {block.title}
                        {isNext ? (
                          <span
                            className="ml-2 rounded-full px-2 py-[2px] align-middle text-[0.64rem] font-bold uppercase tracking-[0.06em]"
                            style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
                          >
                            Now next
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[0.78rem]" style={{ color: "var(--text-2)" }}>
                        {metaLabel}
                      </p>
                    </div>
                    {!isDone && !isNext ? (
                      <button
                        type="button"
                        onClick={() => void handleSkipBlock(block.id)}
                        disabled={isPlanning || skippingBlockId === block.id}
                        className="text-[0.8rem] font-medium text-[var(--text-3)] opacity-0 transition group-hover:opacity-100 disabled:opacity-55"
                      >
                        {skippingBlockId === block.id ? "Skipping…" : "Skip"}
                      </button>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      <footer
        className="anim anim-d4 mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5"
        style={{ borderColor: "var(--line)", color: "var(--text-2)" }}
      >
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.78rem]"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
        >
          {doneCount} of {blocks.length} blocks finished
        </span>
        <span className="text-[0.84rem]">
          <button
            type="button"
            onClick={() => void handleReplan()}
            disabled={isPlanning}
            className="bg-none border-none p-0 text-[0.84rem] font-medium disabled:opacity-60"
            style={{ color: "var(--text-2)" }}
          >
            Adjust plan
          </button>
          <span style={{ color: "var(--text-3)" }}> · </span>
          <button type="button" className="bg-none border-none p-0 text-[0.84rem] font-medium" style={{ color: "var(--text-2)" }}>
            Tomorrow&apos;s preview
          </button>
        </span>
      </footer>
    </div>
  );
}

function getBlockReason(block: StudyBlock) {
  return block.reason ?? "Planned around your current priority and focus window.";
}
