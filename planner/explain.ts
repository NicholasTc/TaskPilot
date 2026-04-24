/**
 * Reason-string builders.
 *
 * Keeping these isolated makes the planner's output self-documenting —
 * the UI can surface these strings verbatim. Rules stay simple and
 * deterministic; no templates, no locale logic.
 */

import type { PlannerTask } from "./types";

type PlacementContext = {
  task: PlannerTask;
  /** The day ("YYYY-MM-DD") the first session actually landed on. */
  firstScheduledDate: string;
  /** The day the planner started looking at (usually "today"). */
  planStartDate: string;
  /** True if the planner fell back to `defaultTaskEstimateMinutes`. */
  usedDefaultEstimate: boolean;
  /** True if the task was split across multiple blocks. */
  wasSplit: boolean;
  /** Total sessions scheduled for this task. */
  sessionTotal: number;
};

export function explainPlacement(ctx: PlacementContext): string {
  const reasons: string[] = [];

  if (ctx.task.dueDate && ctx.task.dueDate < ctx.planStartDate) {
    reasons.push("overdue — scheduled first");
  } else if (ctx.task.priority === "high") {
    reasons.push("high priority");
  } else if (ctx.task.priority === "medium") {
    reasons.push("medium priority");
  } else {
    reasons.push("low priority");
  }

  if (ctx.task.dueDate) {
    const daysOut = daysBetween(ctx.planStartDate, ctx.task.dueDate);
    if (daysOut <= 0) {
      // already covered by "overdue"
    } else if (daysOut === 1) {
      reasons.push("due tomorrow");
    } else if (daysOut <= 7) {
      reasons.push(`due in ${daysOut} days`);
    }
  }

  if (ctx.firstScheduledDate === ctx.planStartDate) {
    reasons.push("fits in today's capacity");
  } else {
    reasons.push(`moved to ${ctx.firstScheduledDate} — earlier days were full`);
  }

  if (ctx.wasSplit) {
    reasons.push(`split across ${ctx.sessionTotal} focus sessions`);
  }

  if (ctx.usedDefaultEstimate) {
    reasons.push("used default duration because no estimate was set");
  }

  return capitalize(reasons.join("; "));
}

export function explainUnscheduled(
  task: PlannerTask,
  remainingMinutes: number,
  horizonDays: number,
): string {
  const base = `${remainingMinutes} min could not fit in the next ${horizonDays} day${
    horizonDays === 1 ? "" : "s"
  }`;
  if (task.dueDate && task.dueDate < addDayKey(todayFromTask(task), horizonDays)) {
    return `${base}; consider raising priority or extending the horizon`;
  }
  return base;
}

/**
 * Placement reason for a single block, leaning on the task-level reason
 * so the UI can show "why this block exists" without repeating work.
 */
export function explainBlock(args: {
  task: PlannerTask;
  sessionIndex: number;
  sessionTotal: number;
  date: string;
  planStartDate: string;
}): string {
  const { sessionIndex, sessionTotal, date, planStartDate } = args;
  const when =
    date === planStartDate ? "today" : `later on ${date}`;
  if (sessionTotal > 1) {
    return `Session ${sessionIndex + 1} of ${sessionTotal} — scheduled ${when}`;
  }
  return `Focus session scheduled ${when}`;
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

function addDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function todayFromTask(task: PlannerTask): string {
  // Fallback when we don't have `today` in scope — only used to check
  // whether "overdue" warning is appropriate. Uses createdAt's date.
  return task.createdAt.slice(0, 10);
}

function capitalize(value: string): string {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1);
}
