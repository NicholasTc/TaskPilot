"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Task } from "@/types/task";
import { NextActionBanner } from "@/components/layout/next-action-banner";

type BoardStatus = "backlog" | "planned" | "in_progress" | "done";
type BlockStatus = "planned" | "active" | "done";

type BoardTask = Task & {
  status: BoardStatus;
  dayKey: string | null;
  order: number;
  studyBlockId: string | null;
};

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

type Reminder = {
  id: string;
  title: string;
  note: string;
  dueAt: string;
  done: boolean;
};

type WeekStatDay = {
  dayKey: string;
  total: number;
  done: number;
};

const boardStatuses: BoardStatus[] = ["backlog", "planned", "in_progress", "done"];
const boardStatusMeta: Record<BoardStatus, { label: string; tip: string; dotColor: string }> = {
  backlog: { label: "Backlog", tip: "unscheduled", dotColor: "var(--text-3)" },
  planned: { label: "Planned", tip: "in upcoming blocks", dotColor: "var(--accent)" },
  in_progress: { label: "In Progress", tip: "single focus", dotColor: "var(--warn)" },
  done: { label: "Done", tip: "today", dotColor: "var(--done)" },
};

function toLocalDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStartOfWeek(date: Date) {
  const next = new Date(date);
  const dayIndex = next.getDay();
  const diff = (dayIndex + 6) % 7;
  next.setDate(next.getDate() - diff);
  return next;
}

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

function formatReminderTime(isoDateString: string) {
  const date = new Date(isoDateString);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatWeekRange(startDate: Date) {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const startLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(endDate);
  return `${startLabel} – ${endLabel}`;
}

function getGreetingTitle() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning, Nicholas";
  if (hour < 18) return "Good afternoon, Nicholas";
  return "Good evening, Nicholas";
}

export default function HomePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [boardTasksByStatus, setBoardTasksByStatus] = useState<Record<BoardStatus, BoardTask[]>>({
    backlog: [],
    planned: [],
    in_progress: [],
    done: [],
  });
  const [blocks, setBlocks] = useState<StudyBlock[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [weekStats, setWeekStats] = useState<WeekStatDay[]>([]);

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toLocalDayKey(today), [today]);
  const weekStart = useMemo(() => getStartOfWeek(today), [today]);
  const weekRange = useMemo(() => formatWeekRange(weekStart), [weekStart]);

  const activeBlock = useMemo(
    () => blocks.find((block) => block.status === "active") ?? null,
    [blocks],
  );

  const allBoardTasks = useMemo(
    () => boardStatuses.flatMap((status) => boardTasksByStatus[status]),
    [boardTasksByStatus],
  );

  const activeTask = activeBlock?.activeTaskId
    ? allBoardTasks.find((task) => task.id === activeBlock.activeTaskId) ?? null
    : null;

  const totalBlocksToday = blocks.length;
  const activeBlockIndex = activeBlock
    ? blocks.findIndex((block) => block.id === activeBlock.id) + 1
    : 0;

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

  const boardCounts = useMemo(
    () =>
      boardStatuses.reduce(
        (acc, status) => ({ ...acc, [status]: boardTasksByStatus[status].length }),
        { backlog: 0, planned: 0, in_progress: 0, done: 0 } as Record<BoardStatus, number>,
      ),
    [boardTasksByStatus],
  );

  const totalWeekDone = useMemo(() => weekStats.reduce((sum, day) => sum + day.done, 0), [weekStats]);
  const totalWeekTasks = useMemo(() => weekStats.reduce((sum, day) => sum + day.total, 0), [weekStats]);

  const committedToday = boardCounts.planned + boardCounts.in_progress + boardCounts.done;
  const isInFlow = committedToday > 0;
  const allDoneToday = isInFlow && boardCounts.done === committedToday;

  const redirectToLogin = useCallback(() => {
    router.replace("/login");
  }, [router]);

  const loadHomeData = useCallback(async () => {
    try {
      setErrorMessage(null);
      setIsLoading(true);

      const weekStartKey = toLocalDayKey(getStartOfWeek(new Date()));

      const [boardResponse, blocksResponse, remindersResponse, weekStatsResponse] = await Promise.all([
        fetch(`/api/board?day=${todayKey}`),
        fetch(`/api/blocks?day=${todayKey}`),
        fetch("/api/reminders"),
        fetch(`/api/week-stats?start=${weekStartKey}`),
      ]);

      const hasUnauthorized = [boardResponse, blocksResponse, remindersResponse, weekStatsResponse].some(
        (response) => response.status === 401,
      );
      if (hasUnauthorized) {
        redirectToLogin();
        return;
      }

      if (!boardResponse.ok || !blocksResponse.ok || !remindersResponse.ok || !weekStatsResponse.ok) {
        throw new Error("Unable to load home data.");
      }

      const boardPayload = (await boardResponse.json()) as {
        tasksByStatus: Record<BoardStatus, BoardTask[]>;
      };
      const blocksPayload = (await blocksResponse.json()) as { blocks: StudyBlock[] };
      const remindersPayload = (await remindersResponse.json()) as Reminder[];
      const weekStatsPayload = (await weekStatsResponse.json()) as { days: WeekStatDay[] };

      setBoardTasksByStatus({
        backlog: boardPayload.tasksByStatus.backlog ?? [],
        planned: boardPayload.tasksByStatus.planned ?? [],
        in_progress: boardPayload.tasksByStatus.in_progress ?? [],
        done: boardPayload.tasksByStatus.done ?? [],
      });
      setBlocks((blocksPayload.blocks ?? []).sort((a, b) => a.startMinutes - b.startMinutes));
      setReminders(remindersPayload ?? []);
      setWeekStats(weekStatsPayload.days ?? []);
    } catch (error) {
      console.error("Loading home data failed", error);
      setErrorMessage("Could not load home data. Please refresh or try again.");
    } finally {
      setIsLoading(false);
    }
  }, [redirectToLogin, todayKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadHomeData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadHomeData]);

  useEffect(() => {
    if (!activeBlock || activeBlock.timerState !== "running") return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeBlock]);

  useEffect(() => {
    if (!activeBlock || activeBlock.timerState !== "running") return;
    const interval = window.setInterval(() => {
      void loadHomeData();
    }, 20000);
    return () => window.clearInterval(interval);
  }, [activeBlock, loadHomeData]);

  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <header className="anim mb-7">
        <h1 className="text-[1.95rem] font-bold leading-[1.1] tracking-[-0.03em]">{getGreetingTitle()}</h1>
        <p className="mt-1.5 text-[0.95rem]" style={{ color: "var(--text-2)" }}>
          {totalWeekTasks > 0
            ? `You're ${totalWeekDone} of ${totalWeekTasks} tasks done this week — keep the momentum going.`
            : "Plan your day and lock in your focus blocks."}
        </p>
      </header>

      {errorMessage ? (
        <div
          className="mb-5 rounded-[12px] border px-4 py-3 text-[0.86rem]"
          style={{ borderColor: "var(--line)", background: "var(--surface-solid)", color: "var(--danger)" }}
        >
          {errorMessage}
        </div>
      ) : null}

      {!isLoading && isInFlow ? (
        allDoneToday ? (
          <NextActionBanner
            step={4}
            eyebrow="Step 4 · Reflect"
            title="You finished today's plan."
            description="Take a moment to recap, then plan tomorrow."
            tone="done"
            ctaLabel="Open Reflect"
            ctaHref="/today"
          />
        ) : activeBlock ? (
          <NextActionBanner
            step={3}
            eyebrow="Step 3 · Execute"
            title={activeTask ? `Now: ${activeTask.name}` : "Pick the one task to work on."}
            description={activeTask
              ? `Open focus mode and protect this block.`
              : "Choose one task from this block and start the timer."}
            tone="warn"
            ctaLabel={activeTask ? "Open focus mode" : "Manage block"}
            ctaHref={activeTask ? `/blocks/${activeBlock.id}/focus` : "/blocks"}
          />
        ) : (
          <NextActionBanner
            step={3}
            eyebrow="Step 3 · Execute"
            title="Start your next block."
            description={`${committedToday - boardCounts.done} task${committedToday - boardCounts.done === 1 ? "" : "s"} remaining today.`}
            tone="accent"
            ctaLabel="Open Blocks"
            ctaHref="/blocks"
          />
        )
      ) : null}

      {isLoading ? (
        <div
          className="mb-4 h-[180px] animate-pulse rounded-[18px] border"
          style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
        />
      ) : activeBlock ? (
        <section
          className="anim anim-d1 relative mb-4 grid grid-cols-[1fr_auto] items-center gap-6 overflow-hidden rounded-[18px] px-7 py-6 text-white max-[800px]:grid-cols-1"
          style={{
            background: "linear-gradient(135deg, #007aff, #5856d6)",
            boxShadow: "0 8px 24px rgba(0,122,255,0.20)",
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-[30px] -top-[60px] h-[220px] w-[220px] rounded-full"
            style={{ background: "rgba(255,255,255,0.07)" }}
          />
          <div className="relative">
            <div className="mb-2 inline-flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.05em] opacity-85">
              <span className="pulse-dot inline-block h-[7px] w-[7px] rounded-full bg-white" />
              Active block{totalBlocksToday > 0 ? ` · ${activeBlockIndex} of ${totalBlocksToday} today` : ""}
            </div>
            <h2 className="mb-1 text-[1.35rem] font-bold tracking-[-0.02em]">{activeBlock.title}</h2>
            <p className="mb-3.5 text-[0.92rem] opacity-90">
              {activeTask ? `Now: ${activeTask.name}` : "No active task selected"}
            </p>
          </div>
          <div className="relative text-right max-[800px]:text-left">
            <div className="text-[2.2rem] font-bold leading-none tracking-[-0.04em] tabular-nums">
              {formatClock(activeBlockRemainingSeconds)}
            </div>
            <div className="mt-1.5 text-[0.78rem] opacity-85">
              remaining · {toHumanTime(activeBlock.startMinutes)} – {toHumanTime(activeBlock.startMinutes + activeBlock.durationMin)}
            </div>
          </div>
        </section>
      ) : !isInFlow ? (
        <section
          className="anim anim-d1 mb-4 rounded-[14px] px-[18px] py-3.5"
          style={{
            background: "var(--surface-solid)",
            border: "1px dashed var(--line-strong)",
          }}
        >
          <span className="text-[0.9rem]" style={{ color: "var(--text-2)" }}>
            No active block right now — use Start Day to begin.
          </span>
        </section>
      ) : null}

      <section
        className="anim anim-d2 mb-7 rounded-[16px] border px-5 py-[18px]"
        style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
      >
        <header className="mb-3.5 flex items-center justify-between">
          <div className="flex items-baseline gap-2.5">
            <h3 className="text-base font-semibold tracking-[-0.01em]">Today&apos;s Board</h3>
            <span className="text-[0.8rem]" style={{ color: "var(--text-3)" }}>
              snapshot
            </span>
          </div>
          <Link
            href="/board"
            className="inline-flex items-center gap-1 text-[0.82rem] font-medium"
            style={{ color: "var(--accent)" }}
          >
            Open Board
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </Link>
        </header>
        <div className="grid grid-cols-4 gap-2.5 max-[820px]:grid-cols-2">
          {boardStatuses.map((status) => {
            const isProgress = status === "in_progress";
            return (
              <Link
                key={status}
                href="/board"
                className="rounded-[12px] border px-3.5 py-3 transition-[border-color,background] duration-200"
                style={{
                  background: isProgress ? "var(--warn-soft)" : "var(--surface-hover)",
                  borderColor: isProgress ? "var(--warn)" : "var(--line)",
                }}
              >
                <div
                  className="mb-2 flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.03em]"
                  style={{ color: isProgress ? "var(--warn)" : "var(--text-2)" }}
                >
                  <span
                    className="h-[7px] w-[7px] rounded-full"
                    style={{ background: boardStatusMeta[status].dotColor }}
                  />
                  {boardStatusMeta[status].label}
                </div>
                <div
                  className="text-[1.6rem] font-bold leading-none tracking-[-0.02em] tabular-nums"
                  style={{ color: isProgress ? "var(--warn)" : "var(--text)" }}
                >
                  {boardCounts[status]}
                </div>
                <p className="mt-1.5 text-[0.76rem]" style={{ color: "var(--text-3)" }}>
                  {boardStatusMeta[status].tip}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-[1.5fr_1fr] gap-5 max-[900px]:grid-cols-1">
        <section className="anim anim-d3">
          <h2
            className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.05em]"
            style={{ color: "var(--text-3)" }}
          >
            Today&apos;s blocks
          </h2>
          <div
            className="rounded-[16px] border px-5 py-[18px]"
            style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
          >
            {blocks.length === 0 ? (
              <p className="py-2 text-[0.86rem]" style={{ color: "var(--text-2)" }}>
                No blocks planned for today.
              </p>
            ) : (
              blocks.map((block, index) => (
                <article
                  key={block.id}
                  className="grid grid-cols-[60px_1fr_auto] items-center gap-3.5 border-b py-3 last:border-b-0 max-[720px]:grid-cols-1 max-[720px]:gap-1.5"
                  style={{
                    borderBottomColor: index === blocks.length - 1 ? "transparent" : "var(--line)",
                  }}
                >
                  <div>
                    <div className="text-[0.92rem] font-semibold tabular-nums">
                      {toHumanTime(block.startMinutes)}
                    </div>
                    <div className="mt-0.5 text-[0.72rem]" style={{ color: "var(--text-3)" }}>
                      – {toHumanTime(block.startMinutes + block.durationMin)}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[0.92rem] font-medium">{block.title}</p>
                    <p className="mt-0.5 text-[0.76rem]" style={{ color: "var(--text-2)" }}>
                      {block.durationMin}m
                    </p>
                  </div>
                  <span
                    className="inline-flex items-center rounded-full px-2 py-[3px] text-[0.7rem] font-semibold uppercase tracking-[0.03em]"
                    style={{
                      background:
                        block.status === "active"
                          ? "var(--warn-soft)"
                          : block.status === "done"
                            ? "var(--done-soft)"
                            : "var(--accent-soft)",
                      color:
                        block.status === "active"
                          ? "var(--warn)"
                          : block.status === "done"
                            ? "var(--done)"
                            : "var(--accent)",
                    }}
                  >
                    {block.status === "active" ? "Active" : block.status === "done" ? "Done" : "Upcoming"}
                  </span>
                </article>
              ))
            )}
          </div>
        </section>

        <aside className="anim anim-d4">
          <h2
            className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.05em]"
            style={{ color: "var(--text-3)" }}
          >
            Reminders
          </h2>
          <div
            className="rounded-[16px] border px-5 py-[18px]"
            style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
          >
            {reminders.length === 0 ? (
              <p className="py-2 text-[0.86rem]" style={{ color: "var(--text-2)" }}>
                No reminders yet.
              </p>
            ) : (
              reminders.slice(0, 5).map((reminder, index, list) => (
                <article
                  key={reminder.id}
                  className="flex items-start justify-between gap-3 border-b py-3 last:border-b-0"
                  style={{
                    borderBottomColor: index === list.length - 1 ? "transparent" : "var(--line)",
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-[0.9rem] font-medium">{reminder.title}</p>
                    {reminder.note ? (
                      <p className="mt-0.5 text-[0.76rem]" style={{ color: "var(--text-2)" }}>
                        {reminder.note}
                      </p>
                    ) : null}
                  </div>
                  <span className="whitespace-nowrap text-[0.76rem]" style={{ color: "var(--text-3)" }}>
                    {formatReminderTime(reminder.dueAt)}
                  </span>
                </article>
              ))
            )}
          </div>
        </aside>
      </div>

      <section
        className="anim anim-d4 mt-6 rounded-[16px] border px-5 py-[18px]"
        style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
      >
        <header className="mb-3.5 flex items-baseline justify-between">
          <h3 className="text-base font-semibold tracking-[-0.01em]">This week</h3>
          <span className="text-[0.8rem]" style={{ color: "var(--text-3)" }}>
            {weekRange}
          </span>
        </header>
        <div className="grid grid-cols-7 gap-2">
          {weekStats.map((day) => {
            const date = new Date(`${day.dayKey}T00:00:00`);
            const label = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
            const isToday = day.dayKey === todayKey;
            const fillPercent = day.total > 0 ? Math.max(4, Math.round((day.done / day.total) * 100)) : 0;

            return (
              <div key={day.dayKey} className="text-center">
                <div
                  className="mb-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.04em]"
                  style={{ color: isToday ? "var(--accent)" : "var(--text-3)" }}
                >
                  {label}
                </div>
                <div
                  className="relative h-[38px] overflow-hidden rounded-[10px] transition-transform duration-200 hover:-translate-y-[1px]"
                  style={{
                    background: isToday ? "var(--accent-soft)" : "var(--surface-hover)",
                    outline: isToday ? "2px solid var(--accent)" : "none",
                    outlineOffset: isToday ? "2px" : "0",
                  }}
                >
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-[10px]"
                    style={{
                      height: `${fillPercent}%`,
                      background: isToday ? "var(--accent)" : "var(--done)",
                    }}
                  />
                </div>
                <div className="mt-1.5 text-[0.76rem]" style={{ color: "var(--text-2)" }}>
                  {day.total > 0 ? `${day.done}/${day.total}` : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
