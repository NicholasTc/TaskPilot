"use client";

import Link from "next/link";
import { useMemo } from "react";

export type MonthCalendarDayStat = {
  dayKey: string;
  total: number;
  done: number;
};

type MonthCalendarProps = {
  /**
   * Any date within the month to render. The component will derive the full
   * month grid (Monday-start, 6 rows) from this value in the user's local
   * timezone.
   */
  monthDate: Date;
  /** YYYY-MM-DD local day key for "today", used to highlight the current day. */
  todayKey: string;
  /** Per-day aggregates fetched from /api/range-stats for the visible grid. */
  dayStats: MonthCalendarDayStat[];
  /** Optional title override. Defaults to "My calendar". */
  title?: string;
  /**
   * Where clicks should navigate. The selected dayKey is appended as
   * `?day=YYYY-MM-DD`. Defaults to "/blocks".
   */
  hrefBase?: string;
  /** When true, shows skeleton shimmer instead of real cells. */
  isLoading?: boolean;
};

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

function toLocalDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns the Monday-aligned start of the week containing `date`, in local time.
 * getDay() returns 0=Sun..6=Sat; shifting by (day+6)%7 gives Monday=0.
 */
function getMondayStartOfWeek(date: Date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  return copy;
}

/**
 * Returns a 42-cell grid (6 weeks × 7 days) starting from the Monday on or
 * before the 1st of `monthDate`'s month. This guarantees a stable, complete
 * rectangle regardless of which weekday the month starts on.
 */
function buildMonthGrid(monthDate: Date) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = getMondayStartOfWeek(firstOfMonth);
  const cells: Array<{ date: Date; dayKey: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i += 1) {
    const cell = new Date(gridStart);
    cell.setDate(gridStart.getDate() + i);
    cells.push({
      date: cell,
      dayKey: toLocalDayKey(cell),
      inMonth: cell.getMonth() === monthDate.getMonth(),
    });
  }
  return cells;
}

export function MonthCalendar({
  monthDate,
  todayKey,
  dayStats,
  title = "My calendar",
  hrefBase = "/blocks",
  isLoading = false,
}: MonthCalendarProps) {
  const cells = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
  const statsByDay = useMemo(() => {
    const map = new Map<string, MonthCalendarDayStat>();
    for (const entry of dayStats) map.set(entry.dayKey, entry);
    return map;
  }, [dayStats]);

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(monthDate),
    [monthDate],
  );

  return (
    <section
      className="rounded-[16px] border px-5 py-[18px]"
      style={{
        background: "var(--surface-solid)",
        borderColor: "var(--line)",
        boxShadow: "var(--shadow-sm)",
      }}
      aria-label="Monthly plan calendar"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-base font-semibold tracking-[-0.01em]">{title}</h3>
        <span className="text-[0.8rem]" style={{ color: "var(--text-3)" }}>
          {monthLabel}
        </span>
      </header>

      <div
        className="mb-1 grid grid-cols-7 gap-1 text-center text-[0.6rem] font-semibold uppercase tracking-[0.1em]"
        style={{ color: "var(--text-3)" }}
        aria-hidden
      >
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={monthLabel}>
        {cells.map((cell) => {
          const stat = statsByDay.get(cell.dayKey);
          const total = stat?.total ?? 0;
          const done = stat?.done ?? 0;
          const fillPercent = total > 0 ? Math.max(6, Math.round((done / total) * 100)) : 0;

          const isToday = cell.dayKey === todayKey;
          const isPast = cell.dayKey < todayKey;
          const isOtherMonth = !cell.inMonth;

          const ariaLabelBase = new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          }).format(cell.date);
          const ariaLabel =
            total > 0
              ? `${ariaLabelBase}, ${done} of ${total} tasks done`
              : `${ariaLabelBase}, no tasks`;

          return (
            <Link
              key={cell.dayKey}
              href={`${hrefBase}?day=${cell.dayKey}`}
              role="gridcell"
              aria-label={ariaLabel}
              aria-current={isToday ? "date" : undefined}
              className="group relative block aspect-[1.35/1] overflow-hidden rounded-[8px] border transition-[transform,border-color,background] duration-150 hover:-translate-y-[1px] focus-visible:-translate-y-[1px] focus-visible:outline-none"
              style={{
                background: isToday
                  ? "var(--accent-soft)"
                  : isOtherMonth
                    ? "transparent"
                    : "var(--surface-hover)",
                borderColor: isToday ? "var(--accent)" : isOtherMonth ? "transparent" : "var(--line)",
                opacity: isLoading ? 0.35 : isOtherMonth ? 0.4 : isPast ? 0.7 : 1,
                boxShadow: isToday ? "0 0 0 1px var(--accent)" : undefined,
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-[7px] transition-[height,background] duration-200"
                style={{
                  height: `${fillPercent}%`,
                  background: isToday
                    ? "var(--accent)"
                    : isPast
                      ? "var(--text-3)"
                      : "var(--done)",
                  opacity: total === 0 ? 0 : isPast && !isToday ? 0.3 : isOtherMonth ? 0.5 : 0.85,
                }}
              />

              <span className="relative flex h-full items-center justify-center">
                <span
                  className="text-[0.74rem] font-semibold leading-none tabular-nums"
                  style={{
                    color: isToday
                      ? "var(--accent)"
                      : isOtherMonth
                        ? "var(--text-3)"
                        : "var(--text)",
                  }}
                >
                  {cell.date.getDate()}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <p className="mt-2 text-[0.68rem]" style={{ color: "var(--text-3)" }}>
        Tap any day to open it on the Today page.
      </p>
    </section>
  );
}
