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
  const [isUpdatingTimer, setIsUpdatingTimer] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isPlanning, setIsPlanning] = useState(false);
  const [skippingBlockId, setSkippingBlockId] = useState<string | null>(null);

  const dayKey = useMemo(() => toLocalDayKey(selectedDate), [selectedDate]);
  const todayKey = useMemo(() => toLocalDayKey(new Date()), []);
  const isToday = dayKey === todayKey;
  const longDateLabel = useMemo(() => formatLongDate(selectedDate), [selectedDate]);

  const activeBlock = useMemo(
    () => blocks.find((block) => block.status === "active") ?? null,
    [blocks],
  );

  const nextPlannedBlock = useMemo(
    () => blocks.find((block) => block.status === "planned") ?? null,
    [blocks],
  );

  const upcomingBlocks = useMemo(
    () =>
      blocks.filter(
        (block) =>
          block.status === "planned" && (!nextPlannedBlock || block.id !== nextPlannedBlock.id),
      ),
    [blocks, nextPlannedBlock],
  );

  const completedBlocks = useMemo(
    () => blocks.filter((block) => block.status === "done"),
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
      console.error("Loading today page failed", error);
      setErrorMessage("Could not load your day. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [dayKey, redirectToLogin]);

  useEffect(() => {
    const parsedDate = parseDayKey(requestedDayKey);
    if (!parsedDate) return;
    setSelectedDate((current) =>
      toLocalDayKey(current) === toLocalDayKey(parsedDate) ? current : parsedDate,
    );
  }, [requestedDayKey]);

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
   * Re-run the auto-planner. Demoted to a quiet footer link in the new
   * UI — auto-schedule is the default, this is just an escape hatch.
   * Preserves active/done blocks, replaces the rest.
   */
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
        error instanceof AutoPlanError
          ? error.message
          : "Could not refresh the plan.";
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
        setSuccessMessage("Skipped — plan updated.");
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
      setSuccessMessage(nextAction === "pause" ? "Paused." : "Resumed.");
    } catch (error) {
      console.error("Toggling block pause failed", error);
      setErrorMessage("Could not update the timer.");
    } finally {
      setIsUpdatingTimer(false);
    }
  };

  const getBlockTasks = (blockId: string) =>
    allTasksForDay
      .filter((task) => task.studyBlockId === blockId)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const totalBlocksToday = blocks.length;
  const plannedCount = blocks.filter((b) => b.status === "planned").length;
  const doneCount = completedBlocks.length;

  // One calm sentence for the header — adapts to where the user is in the day.
  const heroBlock = activeBlock ?? nextPlannedBlock;
  const subtitle = (() => {
    if (totalBlocksToday === 0) {
      return isToday
        ? "Add a few tasks and we'll organize your day into focus blocks."
        : "Nothing planned for this day yet.";
    }
    if (activeBlock) return "A block is running. Stay with it — you've got this.";
    if (heroBlock) {
      return isToday
        ? "Your day is ready. Start with the next block, or adjust the plan."
        : `Your plan for ${formatShortDate(selectedDate)}.`;
    }
    if (doneCount === totalBlocksToday) {
      return "Every block is done. Nice work today.";
    }
    return "Your plan for the day.";
  })();

  return (
    <div className="mx-auto w-full max-w-[860px]">
      {/* ------------------------------------------------------------------
         Header — calm framing, no step language.
         ------------------------------------------------------------------ */}
      <header className="anim mb-6">
        <p
          className="mb-1.5 text-[0.78rem] font-semibold uppercase tracking-[0.06em]"
          style={{ color: "var(--text-3)" }}
        >
          {isToday ? `Today · ${longDateLabel}` : longDateLabel}
        </p>
        <h1 className="text-[2rem] font-bold leading-[1.05] tracking-[-0.03em]">
          {isToday ? "Your day" : "Your plan"}
        </h1>
        <p className="mt-2 text-[0.95rem]" style={{ color: "var(--text-2)" }}>
          {subtitle}
        </p>
      </header>

      {/* ------------------------------------------------------------------
         Inline status / toast row — quiet, never primary.
         ------------------------------------------------------------------ */}
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

      {/* ------------------------------------------------------------------
         Compact daily summary — scannable in under a second.
         ------------------------------------------------------------------ */}
      {!isLoading && totalBlocksToday > 0 ? (
        <DailySummary
          plannedCount={plannedCount + (activeBlock ? 1 : 0)}
          doneCount={doneCount}
          totalCount={totalBlocksToday}
          nextLabel={
            activeBlock
              ? `In progress · ${activeBlock.title}`
              : nextPlannedBlock
                ? `Next at ${toHumanTime(nextPlannedBlock.startMinutes)} · ${nextPlannedBlock.title}`
                : "All done for today"
          }
        />
      ) : null}

      {/* ------------------------------------------------------------------
         Hero — the *one* clear primary action on the page.
         Active block (gradient timer card) takes priority; otherwise the
         next planned block becomes the hero with a clear "Start block" CTA.
         ------------------------------------------------------------------ */}
      {isLoading ? (
        <div
          className="anim anim-d1 mb-8 h-[200px] animate-pulse rounded-[18px] border"
          style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
        />
      ) : activeBlock ? (
        <ActiveBlockHero
          block={activeBlock}
          tasks={getBlockTasks(activeBlock.id)}
          remainingSeconds={activeBlockRemainingSeconds}
          onOpenFocus={() => router.push(`/blocks/${activeBlock.id}/focus`)}
          onTogglePause={() =>
            void handleTogglePauseBlock(
              activeBlock.id,
              activeBlock.timerState === "running" ? "pause" : "resume",
            )
          }
          onEnd={() => void handleEndBlock(activeBlock.id)}
          isUpdatingTimer={isUpdatingTimer}
        />
      ) : nextPlannedBlock ? (
        <NextBlockHero
          block={nextPlannedBlock}
          tasks={getBlockTasks(nextPlannedBlock.id)}
          onStart={() => void handleStartBlock(nextPlannedBlock.id)}
          onSkip={() => void handleSkipBlock(nextPlannedBlock.id)}
          isSkipping={skippingBlockId === nextPlannedBlock.id}
          isPlanning={isPlanning}
        />
      ) : totalBlocksToday > 0 ? (
        <AllDoneHero />
      ) : (
        <EmptyDayHero
          isToday={isToday}
          isPlanning={isPlanning}
          onPlan={() => void handleReplan()}
        />
      )}

      {/* ------------------------------------------------------------------
         Coming up — the rest of today's blocks, visually quieter than the
         hero. No status pills shouting "UPCOMING"; the list itself implies
         that.
         ------------------------------------------------------------------ */}
      {!isLoading && upcomingBlocks.length > 0 ? (
        <section className="anim anim-d2 mb-8">
          <h2
            className="mb-3 text-[0.74rem] font-semibold uppercase tracking-[0.06em]"
            style={{ color: "var(--text-3)" }}
          >
            Later today
          </h2>
          <ul className="space-y-2">
            {upcomingBlocks.map((block) => (
              <UpcomingBlockRow
                key={block.id}
                block={block}
                tasks={getBlockTasks(block.id)}
                onSkip={() => void handleSkipBlock(block.id)}
                isSkipping={skippingBlockId === block.id}
                isPlanning={isPlanning}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* ------------------------------------------------------------------
         Completed — collapsed visual weight; just a calm "look how far
         you got" footer instead of celebratory pills.
         ------------------------------------------------------------------ */}
      {!isLoading && completedBlocks.length > 0 ? (
        <section className="anim anim-d3 mb-8">
          <h2
            className="mb-3 text-[0.74rem] font-semibold uppercase tracking-[0.06em]"
            style={{ color: "var(--text-3)" }}
          >
            Completed
          </h2>
          <ul className="space-y-1.5">
            {completedBlocks.map((block) => (
              <CompletedBlockRow
                key={block.id}
                block={block}
                tasks={getBlockTasks(block.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* ------------------------------------------------------------------
         Footer controls — demoted to muted text links so they're available
         but never compete with the hero CTA.
         ------------------------------------------------------------------ */}
      <FooterControls
        selectedDate={selectedDate}
        onPrev={() => setSelectedDate((current) => addDays(current, -1))}
        onNext={() => setSelectedDate((current) => addDays(current, 1))}
        onToday={() => setSelectedDate(new Date())}
        showToday={!isToday}
        onReplan={() => void handleReplan()}
        isPlanning={isPlanning}
        showReplan={totalBlocksToday > 0}
      />
    </div>
  );
}

/* ====================================================================
   Subcomponents — kept colocated to keep this page readable as a unit.
   ==================================================================== */

function DailySummary({
  plannedCount,
  doneCount,
  totalCount,
  nextLabel,
}: {
  plannedCount: number;
  doneCount: number;
  totalCount: number;
  nextLabel: string;
}) {
  const remaining = Math.max(0, totalCount - doneCount);
  return (
    <div
      className="anim anim-d1 mb-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.86rem]"
      style={{ color: "var(--text-2)" }}
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--accent)" }}
        />
        <span className="font-semibold tabular-nums" style={{ color: "var(--text)" }}>
          {remaining}
        </span>
        block{remaining === 1 ? "" : "s"} to go
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--done)" }}
        />
        <span className="font-semibold tabular-nums" style={{ color: "var(--text)" }}>
          {doneCount}
        </span>
        done
      </span>
      <span className="text-[0.86rem]" style={{ color: "var(--text-3)" }}>
        ·
      </span>
      <span className="truncate">{nextLabel}</span>
    </div>
  );
}

function ActiveBlockHero({
  block,
  tasks,
  remainingSeconds,
  onOpenFocus,
  onTogglePause,
  onEnd,
  isUpdatingTimer,
}: {
  block: StudyBlock;
  tasks: BoardTask[];
  remainingSeconds: number;
  onOpenFocus: () => void;
  onTogglePause: () => void;
  onEnd: () => void;
  isUpdatingTimer: boolean;
}) {
  return (
    <section
      className="anim anim-d1 relative mb-8 overflow-hidden rounded-[18px] px-7 py-7 text-white"
      style={{
        background: "linear-gradient(135deg, #007aff, #5856d6)",
        boxShadow: "0 10px 28px rgba(0,122,255,0.22)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-[40px] -top-[40px] h-[200px] w-[200px] rounded-full"
        style={{ background: "rgba(255,255,255,0.08)" }}
      />
      <div className="relative">
        <div className="mb-2 inline-flex items-center gap-2 text-[0.74rem] font-semibold uppercase tracking-[0.06em] opacity-85">
          <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-white" />
          In progress
        </div>
        <h2 className="text-[1.55rem] font-bold tracking-[-0.02em]">{block.title}</h2>
        <p className="mt-1 text-[0.92rem] opacity-90">
          {toHumanTime(block.startMinutes)} – {toHumanTime(block.startMinutes + block.durationMin)} · {formatDurationLabel(block.durationMin)}
        </p>

        <div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-6 max-[640px]:grid-cols-1 max-[640px]:items-start">
          <div className="flex flex-col gap-2 text-[0.92rem]">
            {tasks.length === 0 ? (
              <p className="opacity-85">No tasks linked yet — open focus to pick one.</p>
            ) : (
              tasks.slice(0, 3).map((task) => (
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
              {formatClock(remainingSeconds)}
            </div>
            <div className="mt-1 text-[0.8rem] opacity-80">
              {block.timerState === "running" ? "running" : "paused"} · time left
            </div>
          </div>
        </div>

        <div className="relative mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenFocus}
            className="h-[40px] rounded-[10px] px-5 text-[0.88rem] font-semibold transition active:scale-[0.98]"
            style={{ background: "#fff", color: "var(--accent)" }}
          >
            Open focus mode
          </button>
          <button
            type="button"
            onClick={onTogglePause}
            disabled={isUpdatingTimer || remainingSeconds <= 0}
            className="h-[34px] rounded-[8px] px-3.5 text-[0.82rem] font-medium text-white transition"
            style={{
              background: "rgba(255,255,255,0.16)",
              opacity: isUpdatingTimer || remainingSeconds <= 0 ? 0.55 : 1,
            }}
          >
            {block.timerState === "running" ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            onClick={onEnd}
            className="h-[34px] rounded-[8px] px-3.5 text-[0.82rem] font-medium text-white transition"
            style={{ background: "rgba(255,255,255,0.16)" }}
          >
            Finish
          </button>
        </div>
      </div>
    </section>
  );
}

function NextBlockHero({
  block,
  tasks,
  onStart,
  onSkip,
  isSkipping,
  isPlanning,
}: {
  block: StudyBlock;
  tasks: BoardTask[];
  onStart: () => void;
  onSkip: () => void;
  isSkipping: boolean;
  isPlanning: boolean;
}) {
  return (
    <section
      className="anim anim-d1 mb-8 rounded-[18px] border px-7 py-7"
      style={{
        background: "var(--surface-solid)",
        borderColor: "var(--line)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      <div className="mb-2 flex items-center gap-2 text-[0.74rem] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--accent)" }}>
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />
        Next up · {toHumanTime(block.startMinutes)}
      </div>
      <h2 className="text-[1.6rem] font-bold leading-[1.15] tracking-[-0.025em]">
        {block.title}
      </h2>
      <p className="mt-1.5 text-[0.92rem]" style={{ color: "var(--text-2)" }}>
        {toHumanTime(block.startMinutes)} – {toHumanTime(block.startMinutes + block.durationMin)} · {formatDurationLabel(block.durationMin)}
      </p>

      {/* Tasks for this block — readable at a glance, not a checklist UI. */}
      {tasks.length > 0 ? (
        <ul className="mt-5 space-y-2">
          {tasks.slice(0, 4).map((task) => (
            <li key={task.id} className="flex items-center gap-2.5 text-[0.92rem]">
              <span
                className="h-[6px] w-[6px] flex-shrink-0 rounded-full"
                style={{ background: "var(--text-3)" }}
              />
              <span style={{ color: "var(--text)" }}>{task.name}</span>
            </li>
          ))}
          {tasks.length > 4 ? (
            <li className="ml-[14px] text-[0.82rem]" style={{ color: "var(--text-3)" }}>
              +{tasks.length - 4} more
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-5 text-[0.88rem]" style={{ color: "var(--text-3)" }}>
          A flexible block — use it however suits you right now.
        </p>
      )}

      {block.reason ? (
        <p
          className="mt-4 text-[0.8rem]"
          style={{ color: "var(--text-3)" }}
        >
          Planned because: {block.reason}
        </p>
      ) : null}

      {/* One clear primary CTA. Skip is intentionally text-style and quiet. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          className="inline-flex h-[44px] items-center gap-2 rounded-[12px] px-6 text-[0.92rem] font-semibold text-white transition active:scale-[0.98]"
          style={{
            background: "var(--accent)",
            boxShadow: "0 4px 12px rgba(0,122,255,0.25)",
          }}
        >
          Start block
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={isSkipping || isPlanning}
          className="text-[0.84rem] font-medium transition-colors hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-55"
          style={{ color: "var(--text-2)" }}
        >
          {isSkipping ? "Skipping…" : "Skip for now"}
        </button>
      </div>
    </section>
  );
}

function AllDoneHero() {
  return (
    <section
      className="anim anim-d1 mb-8 rounded-[18px] border px-7 py-8 text-center"
      style={{
        background: "var(--done-soft)",
        borderColor: "var(--done)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full"
        style={{ background: "var(--done)", color: "#fff" }}
      >
        <svg viewBox="0 0 16 16" className="h-5 w-5" fill="currentColor">
          <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
        </svg>
      </div>
      <h2 className="text-[1.4rem] font-bold tracking-[-0.02em]">You finished today&apos;s plan.</h2>
      <p className="mt-1.5 text-[0.92rem]" style={{ color: "var(--text-2)" }}>
        Take a beat. Tomorrow can wait until tomorrow.
      </p>
    </section>
  );
}

function EmptyDayHero({
  isToday,
  isPlanning,
  onPlan,
}: {
  isToday: boolean;
  isPlanning: boolean;
  onPlan: () => void;
}) {
  return (
    <section
      className="anim anim-d1 mb-8 rounded-[18px] border px-7 py-10 text-center"
      style={{
        background: "var(--surface-solid)",
        borderColor: "var(--line-strong)",
        borderStyle: "dashed",
      }}
    >
      <h2 className="text-[1.25rem] font-semibold tracking-[-0.01em]">
        {isToday ? "Nothing planned yet." : "No schedule for this day yet."}
      </h2>
      <p className="mx-auto mt-2 max-w-[420px] text-[0.9rem]" style={{ color: "var(--text-2)" }}>
        Add a few tasks, and we&apos;ll organize them into focus blocks for you.
      </p>
      <div className="mt-5 flex justify-center gap-3">
        <button
          type="button"
          onClick={onPlan}
          disabled={isPlanning}
          className="inline-flex h-[40px] items-center gap-2 rounded-[10px] px-5 text-[0.88rem] font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
          style={{ background: "var(--accent)" }}
        >
          {isPlanning ? "Planning…" : "Plan my day"}
        </button>
      </div>
    </section>
  );
}

function UpcomingBlockRow({
  block,
  tasks,
  onSkip,
  isSkipping,
  isPlanning,
}: {
  block: StudyBlock;
  tasks: BoardTask[];
  onSkip: () => void;
  isSkipping: boolean;
  isPlanning: boolean;
}) {
  const taskSummary =
    tasks.length === 0
      ? "Flexible block"
      : tasks
          .slice(0, 2)
          .map((t) => t.name)
          .join(" · ") + (tasks.length > 2 ? ` +${tasks.length - 2}` : "");

  return (
    <li>
      <article
        className="group grid grid-cols-[88px_1fr_auto] items-center gap-4 rounded-[14px] border px-5 py-3.5 transition-[border-color,background] duration-200 hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)] max-[600px]:grid-cols-1 max-[600px]:gap-1.5"
        style={{
          background: "var(--surface-solid)",
          borderColor: "var(--line)",
        }}
      >
        <div className="flex flex-col">
          <span className="text-[0.95rem] font-semibold tabular-nums" style={{ color: "var(--text)" }}>
            {toHumanTime(block.startMinutes)}
          </span>
          <span className="text-[0.74rem]" style={{ color: "var(--text-3)" }}>
            {formatDurationLabel(block.durationMin)}
          </span>
        </div>

        <div className="min-w-0">
          <p className="truncate text-[0.94rem] font-medium" style={{ color: "var(--text)" }}>
            {block.title}
          </p>
          <p className="mt-0.5 truncate text-[0.8rem]" style={{ color: "var(--text-2)" }}>
            {taskSummary}
          </p>
        </div>

        <button
          type="button"
          onClick={onSkip}
          disabled={isSkipping || isPlanning}
          className="text-[0.8rem] font-medium opacity-0 transition-opacity duration-150 hover:text-[var(--danger)] focus:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-55 max-[600px]:opacity-100"
          style={{ color: "var(--text-3)" }}
        >
          {isSkipping ? "Skipping…" : "Skip"}
        </button>
      </article>
    </li>
  );
}

function CompletedBlockRow({
  block,
  tasks,
}: {
  block: StudyBlock;
  tasks: BoardTask[];
}) {
  return (
    <li
      className="grid grid-cols-[88px_1fr_auto] items-center gap-4 rounded-[12px] px-5 py-2.5 max-[600px]:grid-cols-1 max-[600px]:gap-1"
      style={{ background: "transparent", color: "var(--text-2)" }}
    >
      <span className="text-[0.86rem] tabular-nums" style={{ color: "var(--text-3)" }}>
        {toHumanTime(block.startMinutes)}
      </span>
      <span
        className="truncate text-[0.88rem]"
        style={{ textDecoration: "line-through", color: "var(--text-2)" }}
      >
        {block.title}
      </span>
      <span className="text-[0.78rem]" style={{ color: "var(--text-3)" }}>
        {tasks.length > 0 ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}` : ""}
      </span>
    </li>
  );
}

function FooterControls({
  selectedDate,
  onPrev,
  onNext,
  onToday,
  showToday,
  onReplan,
  isPlanning,
  showReplan,
}: {
  selectedDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  showToday: boolean;
  onReplan: () => void;
  isPlanning: boolean;
  showReplan: boolean;
}) {
  return (
    <footer
      className="anim anim-d4 mt-10 flex flex-wrap items-center justify-between gap-4 border-t pt-6"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="flex items-center gap-1 text-[0.84rem]" style={{ color: "var(--text-2)" }}>
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous day"
          className="grid h-7 w-7 place-items-center rounded-[6px] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 12 6 8l4-4" />
          </svg>
        </button>
        <span className="px-1.5 tabular-nums">{formatShortDate(selectedDate)}</span>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next day"
          className="grid h-7 w-7 place-items-center rounded-[6px] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 4 4 4-4 4" />
          </svg>
        </button>
        {showToday ? (
          <button
            type="button"
            onClick={onToday}
            className="ml-2 text-[0.82rem] font-medium transition-colors hover:text-[var(--text)]"
            style={{ color: "var(--accent)" }}
          >
            Jump to today
          </button>
        ) : null}
      </div>

      {showReplan ? (
        <button
          type="button"
          onClick={onReplan}
          disabled={isPlanning}
          className="text-[0.84rem] font-medium transition-colors hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-55"
          style={{ color: "var(--text-2)" }}
        >
          {isPlanning ? "Refreshing plan…" : "Adjust plan"}
        </button>
      ) : null}
    </footer>
  );
}
