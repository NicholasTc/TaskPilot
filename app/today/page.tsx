"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
};

type WeekStatDay = { dayKey: string; total: number; done: number };

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

function formatWeekRange(startDate: Date) {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const startLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(endDate);
  return `${startLabel} – ${endLabel}`;
}

function formatDateLong(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

export default function ReflectPage() {
  const router = useRouter();
  const [tasksByStatus, setTasksByStatus] = useState<Record<BoardStatus, BoardTask[]>>({
    backlog: [],
    planned: [],
    in_progress: [],
    done: [],
  });
  const [blocks, setBlocks] = useState<StudyBlock[]>([]);
  const [weekStats, setWeekStats] = useState<WeekStatDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toLocalDayKey(today), [today]);
  const weekStart = useMemo(() => getStartOfWeek(today), [today]);
  const weekRange = useMemo(() => formatWeekRange(weekStart), [weekStart]);

  const allTasks = useMemo(
    () =>
      [
        ...tasksByStatus.backlog,
        ...tasksByStatus.planned,
        ...tasksByStatus.in_progress,
        ...tasksByStatus.done,
      ] as BoardTask[],
    [tasksByStatus],
  );

  const committedTasks = useMemo(
    () => allTasks.filter((task) => task.studyBlockId !== null),
    [allTasks],
  );
  const completedTasks = useMemo(
    () => committedTasks.filter((task) => task.status === "done"),
    [committedTasks],
  );

  const totalCommitted = committedTasks.length;
  const totalDone = completedTasks.length;
  const progressPct = totalCommitted > 0 ? Math.round((totalDone / totalCommitted) * 100) : 0;

  const focusedMinutes = useMemo(() => {
    const doneBlockIds = new Set(blocks.filter((b) => b.status === "done").map((b) => b.id));
    return blocks
      .filter((b) => doneBlockIds.has(b.id))
      .reduce((sum, b) => sum + b.durationMin, 0);
  }, [blocks]);

  const tasksByBlock = useMemo(() => {
    const map = new Map<string, BoardTask[]>();
    for (const task of committedTasks) {
      if (!task.studyBlockId) continue;
      if (!map.has(task.studyBlockId)) map.set(task.studyBlockId, []);
      map.get(task.studyBlockId)!.push(task);
    }
    return map;
  }, [committedTasks]);

  const redirectToLogin = useCallback(() => router.replace("/login"), [router]);

  const loadData = useCallback(async () => {
    try {
      setErrorMessage(null);
      setIsLoading(true);

      const weekStartKey = toLocalDayKey(getStartOfWeek(new Date()));
      const [boardResponse, blocksResponse, weekStatsResponse] = await Promise.all([
        fetch(`/api/board?day=${todayKey}`),
        fetch(`/api/blocks?day=${todayKey}`),
        fetch(`/api/week-stats?start=${weekStartKey}`),
      ]);

      if ([boardResponse, blocksResponse, weekStatsResponse].some((r) => r.status === 401)) {
        redirectToLogin();
        return;
      }
      if (!boardResponse.ok || !blocksResponse.ok || !weekStatsResponse.ok) {
        throw new Error("Unable to load reflect data.");
      }

      const boardPayload = (await boardResponse.json()) as {
        tasksByStatus: Record<BoardStatus, BoardTask[]>;
      };
      const blocksPayload = (await blocksResponse.json()) as { blocks: StudyBlock[] };
      const weekStatsPayload = (await weekStatsResponse.json()) as { days: WeekStatDay[] };

      setTasksByStatus({
        backlog: boardPayload.tasksByStatus.backlog ?? [],
        planned: boardPayload.tasksByStatus.planned ?? [],
        in_progress: boardPayload.tasksByStatus.in_progress ?? [],
        done: boardPayload.tasksByStatus.done ?? [],
      });
      setBlocks((blocksPayload.blocks ?? []).sort((a, b) => a.startMinutes - b.startMinutes));
      setWeekStats(weekStatsPayload.days ?? []);
    } catch (error) {
      console.error("Loading reflect data failed", error);
      setErrorMessage("Could not load today's reflection. Please refresh.");
    } finally {
      setIsLoading(false);
    }
  }, [todayKey, redirectToLogin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const allDone = totalCommitted > 0 && totalDone === totalCommitted;
  const noFlowYet = totalCommitted === 0;

  return (
    <div className="mx-auto w-full max-w-[960px]">
      {noFlowYet ? (
        <NextActionBanner
          step={4}
          eyebrow="Step 4 · Reflect"
          title="Nothing committed today yet."
          description="Plan and commit tasks to see your reflection here."
          tone="neutral"
          ctaLabel="Start Day"
          ctaHref="/board"
        />
      ) : allDone ? (
        <NextActionBanner
          step={4}
          eyebrow="Step 4 · Reflect · Complete"
          title="You finished everything you committed to today."
          description="Take a beat — then plan tomorrow."
          tone="done"
          ctaLabel="Plan tomorrow"
          ctaHref="/board"
        />
      ) : (
        <NextActionBanner
          step={4}
          eyebrow="Step 4 · Reflect"
          title={`${totalDone} of ${totalCommitted} done — keep going.`}
          description="You can come back here when you're done. For now, finish your current block."
          tone="accent"
          ctaLabel="Back to Home"
          ctaHref="/"
        />
      )}

      <header className="anim mb-6">
        <p
          className="mb-1.5 text-[0.78rem] font-semibold uppercase tracking-[0.05em]"
          style={{ color: "var(--accent)" }}
        >
          {formatDateLong(today)}
        </p>
        <h1 className="text-[1.95rem] font-bold leading-[1.1] tracking-[-0.03em]">
          Today&apos;s reflection
        </h1>
        <p className="mt-1.5 text-[0.95rem]" style={{ color: "var(--text-2)" }}>
          A snapshot of what you committed to and what you finished.
        </p>
      </header>

      {errorMessage ? (
        <p
          className="mb-4 rounded-[12px] border px-4 py-3 text-[0.86rem]"
          style={{ borderColor: "var(--line)", background: "var(--surface-solid)", color: "var(--danger)" }}
        >
          {errorMessage}
        </p>
      ) : null}

      {/* Progress card */}
      <section
        className="anim anim-d1 mb-6 rounded-[16px] border p-5"
        style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <span
            className="text-[0.78rem] font-semibold uppercase tracking-[0.04em]"
            style={{ color: "var(--text-2)" }}
          >
            Today&apos;s progress
          </span>
          <span className="text-[0.92rem] font-semibold">
            <span style={{ color: "var(--done)" }}>{totalDone}</span> of {totalCommitted} done
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: "linear-gradient(90deg, var(--done), #4cd964)",
            }}
          />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 max-[600px]:grid-cols-1">
          <div className="rounded-[12px] border px-4 py-3" style={{ borderColor: "var(--line)", background: "var(--surface-hover)" }}>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>
              Committed
            </p>
            <p className="mt-1 text-[1.5rem] font-bold tabular-nums">{totalCommitted}</p>
          </div>
          <div className="rounded-[12px] border px-4 py-3" style={{ borderColor: "var(--done)", background: "var(--done-soft)" }}>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.04em]" style={{ color: "var(--done)" }}>
              Done
            </p>
            <p className="mt-1 text-[1.5rem] font-bold tabular-nums">{totalDone}</p>
          </div>
          <div className="rounded-[12px] border px-4 py-3" style={{ borderColor: "var(--line)", background: "var(--surface-hover)" }}>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>
              Focused
            </p>
            <p className="mt-1 text-[1.5rem] font-bold tabular-nums">
              {focusedMinutes}
              <span className="ml-1 text-[0.78rem] font-medium" style={{ color: "var(--text-2)" }}>min</span>
            </p>
          </div>
        </div>
      </section>

      {/* Committed tasks by block */}
      <section className="anim anim-d2 mb-6">
        <h2 className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--text-3)" }}>
          What you committed to
        </h2>
        <div
          className="rounded-[16px] border"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line)", boxShadow: "var(--shadow-sm)" }}
        >
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((s) => (
                <div key={s} className="h-[58px] animate-pulse rounded-[10px]" style={{ background: "var(--surface-hover)" }} />
              ))}
            </div>
          ) : committedTasks.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[0.92rem] font-medium">Nothing committed today.</p>
              <p className="mt-1 text-[0.84rem]" style={{ color: "var(--text-2)" }}>
                Use Start Day above to plan and commit tasks.
              </p>
            </div>
          ) : (
            blocks
              .filter((block) => tasksByBlock.has(block.id))
              .map((block, blockIdx, blockList) => {
                const tasksInBlock = tasksByBlock.get(block.id) ?? [];
                const isLastBlock = blockIdx === blockList.length - 1;
                return (
                  <div
                    key={block.id}
                    className="border-b px-4 py-3 last:border-b-0"
                    style={{ borderBottomColor: isLastBlock ? "transparent" : "var(--line)" }}
                  >
                    <div className="mb-2 flex items-baseline justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[0.84rem] font-semibold tabular-nums">
                          {toHumanTime(block.startMinutes)}
                        </span>
                        <span className="text-[0.92rem] font-semibold">{block.title}</span>
                      </div>
                      <span
                        className="rounded-full px-2 py-[2px] text-[0.7rem] font-semibold uppercase tracking-[0.03em]"
                        style={{
                          background:
                            block.status === "active" ? "var(--warn-soft)"
                              : block.status === "done" ? "var(--done-soft)"
                                : "var(--accent-soft)",
                          color:
                            block.status === "active" ? "var(--warn)"
                              : block.status === "done" ? "var(--done)"
                                : "var(--accent)",
                        }}
                      >
                        {block.status === "active" ? "Active" : block.status === "done" ? "Done" : "Upcoming"}
                      </span>
                    </div>
                    <ul className="ml-1 space-y-1.5">
                      {tasksInBlock.map((task) => (
                        <li key={task.id} className="flex items-center gap-2.5">
                          <span
                            className="grid h-[16px] w-[16px] place-items-center rounded-full"
                            style={{
                              background: task.status === "done" ? "var(--done)" : "transparent",
                              border: task.status === "done" ? "none" : "1.5px solid var(--text-3)",
                            }}
                          >
                            {task.status === "done" ? (
                              <svg viewBox="0 0 16 16" className="h-[8px] w-[8px] fill-white">
                                <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
                              </svg>
                            ) : null}
                          </span>
                          <span
                            className="text-[0.88rem]"
                            style={{
                              color: task.status === "done" ? "var(--text-3)" : "var(--text)",
                              textDecoration: task.status === "done" ? "line-through" : "none",
                            }}
                          >
                            {task.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
          )}
        </div>
      </section>

      {/* This week */}
      <section
        className="anim anim-d3 rounded-[16px] border px-5 py-[18px]"
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
                  className="relative h-[38px] overflow-hidden rounded-[10px]"
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
