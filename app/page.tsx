"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Task } from "@/types/task";

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
  in_progress: { label: "In Progress", tip: "single focus", dotColor: "#ff9500" },
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

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
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

  const redirectToLogin = useCallback(() => {
    router.replace("/login");
  }, [router]);

  const loadHomeData = useCallback(async () => {
    try {
      setErrorMessage(null);
      setIsLoading(true);

      const weekStart = getStartOfWeek(new Date());
      const weekStartKey = toLocalDayKey(weekStart);

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
    <div>
      <section className="mb-7">
        <h1 className="text-[2.25rem] font-bold leading-[1.1] tracking-[-0.035em]">{getGreetingTitle()}</h1>
        <p className="mt-2.5 text-base" style={{ color: "var(--text-2)" }}>
          {totalWeekTasks > 0
            ? `You're ${totalWeekDone} of ${totalWeekTasks} tasks done this week — keep the momentum going.`
            : "Plan your day and lock in your focus blocks."}
        </p>
      </section>

      {errorMessage ? (
        <div
          className="mb-5 rounded-[12px] border px-4 py-3 text-[0.86rem]"
          style={{ borderColor: "var(--line)", background: "var(--surface-solid)", color: "var(--danger)" }}
        >
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mb-10 h-[180px] animate-pulse rounded-[18px] border" style={{ borderColor: "var(--line)" }} />
      ) : activeBlock ? (
        <section
          className="mb-5 grid grid-cols-[1fr_auto] items-center gap-6 rounded-[18px] border px-7 py-6 text-white shadow-[0_8px_24px_rgba(0,122,255,0.2)] max-[800px]:grid-cols-1"
          style={{
            background: "linear-gradient(135deg, #007aff, #5856d6)",
            borderColor: "transparent",
          }}
        >
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.05em] opacity-85">Active block</p>
            <h2 className="mt-1 text-[1.45rem] font-bold tracking-[-0.02em]">{activeBlock.title}</h2>
            <p className="mt-1 text-[0.9rem] opacity-90">
              {activeTask ? `Now: ${activeTask.name}` : "No active task selected"}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/blocks/${activeBlock.id}/focus`}
                className="rounded-[10px] px-4 py-2 text-[0.84rem] font-semibold"
                style={{ background: "#fff", color: "var(--accent)" }}
              >
                Open focus mode
              </Link>
              <Link
                href="/blocks"
                className="rounded-[10px] px-4 py-2 text-[0.84rem] font-semibold"
                style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}
              >
                Manage blocks
              </Link>
            </div>
          </div>
          <div className="text-right max-[800px]:text-left">
            <div className="text-[2.2rem] font-bold leading-none tracking-[-0.04em]">
              {formatClock(activeBlockRemainingSeconds)}
            </div>
            <div className="mt-1 text-[0.8rem] opacity-85">
              remaining · {toHumanTime(activeBlock.startMinutes)} -{" "}
              {toHumanTime(activeBlock.startMinutes + activeBlock.durationMin)}
            </div>
          </div>
        </section>
      ) : (
        <section
          className="mb-5 flex items-center justify-between gap-3 rounded-[14px] border px-5 py-4 max-[700px]:flex-col max-[700px]:items-start"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
        >
          <div>
            <p className="text-[0.95rem] font-semibold">No active block right now.</p>
            <p className="mt-0.5 text-[0.84rem]" style={{ color: "var(--text-2)" }}>
              Start a focused block to begin your deep work session.
            </p>
          </div>
          <Link
            href="/blocks"
            className="rounded-[10px] px-4 py-2 text-[0.84rem] font-semibold text-white"
            style={{ background: "var(--accent)" }}
          >
            Plan blocks
          </Link>
        </section>
      )}

      <section
        className="mb-8 rounded-[16px] border px-5 py-5"
        style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
      >
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold tracking-[-0.01em]">Today&apos;s Board</h3>
            <p className="text-[0.78rem]" style={{ color: "var(--text-3)" }}>
              snapshot
            </p>
          </div>
          <Link
            href="/board"
            className="rounded-[8px] px-2.5 py-1 text-[0.8rem] font-medium"
            style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
          >
            Open Board
          </Link>
        </header>
        <div className="grid grid-cols-4 gap-2 max-[820px]:grid-cols-2">
          {boardStatuses.map((status) => (
            <Link
              key={status}
              href="/board"
              className="rounded-[12px] border px-3 py-3 transition hover:bg-[var(--surface-hover)]"
              style={{
                borderColor: status === "in_progress" ? "rgba(255,149,0,0.4)" : "var(--line)",
                background: status === "in_progress" ? "rgba(255,149,0,0.08)" : "var(--surface-hover)",
              }}
            >
              <div className="mb-1 flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.03em]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: boardStatusMeta[status].dotColor }} />
                {boardStatusMeta[status].label}
              </div>
              <div className="text-[1.45rem] font-bold leading-none tracking-[-0.02em]">{boardCounts[status]}</div>
              <p className="mt-1 text-[0.74rem]" style={{ color: "var(--text-3)" }}>
                {boardStatusMeta[status].tip}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-[1.5fr_1fr] gap-6 max-[900px]:grid-cols-1">
        <section>
          <h2 className="mb-3 text-[0.78rem] font-semibold uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>
            Today&apos;s blocks
          </h2>
          <div
            className="rounded-[16px] border px-5 py-4"
            style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
          >
            {blocks.length === 0 ? (
              <p className="text-[0.84rem]" style={{ color: "var(--text-2)" }}>
                No blocks planned for today.
              </p>
            ) : (
              blocks.map((block, index) => (
                <article
                  key={block.id}
                  className="grid grid-cols-[66px_1fr_auto] items-center gap-3 border-b py-3 max-[720px]:grid-cols-1 max-[720px]:gap-1.5"
                  style={{ borderBottomColor: index === blocks.length - 1 ? "transparent" : "var(--line)" }}
                >
                  <div>
                    <div className="text-[0.92rem] font-semibold">{toHumanTime(block.startMinutes)}</div>
                    <div className="text-[0.72rem]" style={{ color: "var(--text-3)" }}>
                      {block.durationMin}m
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[0.92rem] font-medium">{block.title}</p>
                    <p className="text-[0.76rem]" style={{ color: "var(--text-2)" }}>
                      {toHumanTime(block.startMinutes)} - {toHumanTime(block.startMinutes + block.durationMin)}
                    </p>
                  </div>
                  <span
                    className="w-fit rounded-full px-2.5 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.03em]"
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
                </article>
              ))
            )}
          </div>
        </section>

        <aside>
          <h2 className="mb-3 text-[0.78rem] font-semibold uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>
            Reminders
          </h2>
          <div
            className="rounded-[16px] border px-5 py-4"
            style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
          >
            {reminders.length === 0 ? (
              <p className="text-[0.84rem]" style={{ color: "var(--text-2)" }}>
                No reminders yet.
              </p>
            ) : (
              reminders.slice(0, 5).map((reminder, index) => (
                <article
                  key={reminder.id}
                  className="flex items-start justify-between gap-2 border-b py-3"
                  style={{ borderBottomColor: index === reminders.slice(0, 5).length - 1 ? "transparent" : "var(--line)" }}
                >
                  <div>
                    <p className="text-[0.9rem] font-medium">{reminder.title}</p>
                    {reminder.note ? (
                      <p className="mt-0.5 text-[0.76rem]" style={{ color: "var(--text-3)" }}>
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
        className="mt-8 rounded-[16px] border px-5 py-5"
        style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
      >
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-[-0.01em]">This week</h3>
          <span className="text-[0.8rem]" style={{ color: "var(--text-3)" }}>
            Real completion progress
          </span>
        </header>
        <div className="grid grid-cols-7 gap-2">
          {weekStats.map((day) => {
            const date = new Date(`${day.dayKey}T00:00:00`);
            const label = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
            const isToday = day.dayKey === todayKey;
            const progressPercent = day.total > 0 ? Math.max(4, Math.round((day.done / day.total) * 100)) : 0;

            return (
              <div
                key={day.dayKey}
                className="rounded-[10px] px-1 py-2 text-center"
                style={{ background: isToday ? "var(--accent-soft)" : "transparent" }}
              >
                <p
                  className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.02em]"
                  style={{ color: isToday ? "var(--accent)" : "var(--text-3)" }}
                >
                  {label}
                </p>
                <div
                  className="flex h-12 flex-col justify-end overflow-hidden rounded-lg"
                  style={{
                    background: "var(--line)",
                    outline: isToday ? "2px solid var(--accent)" : "none",
                    outlineOffset: isToday ? "-2px" : "0",
                  }}
                >
                  <div
                    className="rounded-lg bg-[var(--done)]"
                    style={{ height: `${progressPercent}%`, minHeight: day.total > 0 ? "4px" : "0" }}
                  />
                </div>
                <p className="mt-1.5 text-[0.75rem]" style={{ color: isToday ? "var(--accent)" : "var(--text-2)" }}>
                  {day.total > 0 ? `${day.done}/${day.total}` : "—"}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
