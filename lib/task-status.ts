/**
 * Canonical task status rules.
 *
 * The database has two fields that represent completion: `status`
 * ("backlog" | "planned" | "in_progress" | "done") and `completed` (boolean).
 * To avoid drift between them we enforce a single rule across every
 * read/write path:
 *
 *   status is authoritative.
 *   completed is derived: completed === (status === "done").
 *
 * Use these helpers everywhere tasks are written (PATCH, POST, bulk reorder)
 * and read (board, daily-flow, responses) so the UI never sees a task whose
 * `completed` disagrees with its `status`.
 */

import { TASK_STATUSES, TaskStatus } from "@/models/Task";

export type TaskStatusUpdate = {
  status?: TaskStatus | string | null;
  completed?: boolean;
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (TASK_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Given a task's stored state and a partial update, return the canonical
 * next status/completed pair.
 *
 * Precedence:
 *   1. If the patch explicitly sets `status`, use it.
 *   2. Else if the patch explicitly sets `completed`, translate:
 *        true  -> "done"
 *        false -> "planned" if the task was "done", else keep existing status
 *   3. Else preserve the existing status.
 *
 * `completed` is always derived from the resulting status.
 */
export function resolveTaskState(
  existing: { status?: TaskStatus | string | null; completed?: boolean },
  patch: TaskStatusUpdate,
): { status: TaskStatus; completed: boolean } {
  const hasStatus = patch.status !== undefined && patch.status !== null;
  const hasCompleted = typeof patch.completed === "boolean";

  const existingStatus: TaskStatus = isTaskStatus(existing.status)
    ? existing.status
    : existing.completed
      ? "done"
      : "backlog";

  let nextStatus: TaskStatus;
  if (hasStatus && isTaskStatus(patch.status)) {
    nextStatus = patch.status;
  } else if (hasCompleted) {
    if (patch.completed) {
      nextStatus = "done";
    } else {
      nextStatus = existingStatus === "done" ? "planned" : existingStatus;
    }
  } else {
    nextStatus = existingStatus;
  }

  return { status: nextStatus, completed: nextStatus === "done" };
}

/**
 * Normalize a raw task record from the DB so every read path agrees on the
 * task's status and completed value. Prefer this over ad-hoc
 * `task.status ?? (task.completed ? "done" : "backlog")` fallbacks.
 */
export function normalizeTaskState(task: {
  status?: string | null;
  completed?: boolean | null;
}): { status: TaskStatus; completed: boolean } {
  if (isTaskStatus(task.status)) {
    return { status: task.status, completed: task.status === "done" };
  }
  const status: TaskStatus = task.completed ? "done" : "backlog";
  return { status, completed: status === "done" };
}
