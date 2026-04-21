/**
 * Task scoring + ordering.
 *
 * We keep the ranking explicit and rule-based so the behaviour is easy to
 * explain to users ("this was scheduled first because it's high priority
 * and due sooner"). The sort is a stable lexicographic compare over four
 * keys, in order:
 *
 *   1. Overdue flag          (true before false — overdue work is most urgent)
 *   2. Effective priority    (high → medium → low)
 *   3. Due date              (earlier first; null last)
 *   4. createdAt             (older first)
 *
 * Ties on all four keys fall back to the task id, purely for determinism.
 */

import { OVERDUE_BONUS, PRIORITY_WEIGHT } from "./constants";
import type { PlannerTask } from "./types";

export type TaskScore = {
  /** True if dueDate is strictly before `today`. */
  overdue: boolean;
  /** Priority weight plus overdue bonus, higher = more urgent. */
  effectivePriority: number;
  /** Days until due, or null when no dueDate. */
  daysUntilDue: number | null;
  /** ISO timestamp of creation, used as an age tie-breaker. */
  createdAt: string;
};

export function scoreTask(task: PlannerTask, today: string): TaskScore {
  const overdue = task.dueDate !== null && task.dueDate < today;
  const basePriority = PRIORITY_WEIGHT[task.priority];
  const effectivePriority = overdue ? basePriority + OVERDUE_BONUS : basePriority;

  let daysUntilDue: number | null = null;
  if (task.dueDate !== null) {
    daysUntilDue = daysBetween(today, task.dueDate);
  }

  return {
    overdue,
    effectivePriority,
    daysUntilDue,
    createdAt: task.createdAt,
  };
}

export function compareTasks(
  a: PlannerTask,
  b: PlannerTask,
  today: string,
): number {
  const sa = scoreTask(a, today);
  const sb = scoreTask(b, today);

  if (sa.overdue !== sb.overdue) return sa.overdue ? -1 : 1;
  if (sa.effectivePriority !== sb.effectivePriority) {
    return sb.effectivePriority - sa.effectivePriority;
  }

  const dueCompare = compareNullableDueDates(a.dueDate, b.dueDate);
  if (dueCompare !== 0) return dueCompare;

  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

function compareNullableDueDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // nulls go last
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86_400_000);
}

/** Return a new array sorted by `compareTasks`. Does not mutate the input. */
export function sortTasks(tasks: PlannerTask[], today: string): PlannerTask[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, today));
}
