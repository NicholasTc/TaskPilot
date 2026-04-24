/**
 * Single source of truth for the Task JSON shape that the app's API
 * returns. Previously each route re-implemented `toTaskResponse`, which
 * drifted once planner fields entered the schema. Routes now import
 * this helper so board / list / PATCH responses stay in lock-step.
 */

import mongoose from "mongoose";
import { normalizeTaskState } from "@/lib/task-status";
import { normalizeTaskFields, type TaskPriority } from "@/lib/task-fields";

export type TaskResponseBody = {
  id: string;
  name: string;
  meta: string;
  completed: boolean;
  dayKey: string | null;
  status: "backlog" | "planned" | "in_progress" | "done";
  order: number;
  studyBlockId: string | null;
  priority: TaskPriority;
  /** "YYYY-MM-DD" or null. */
  dueDate: string | null;
  estimatedMinutes: number | null;
};

type TaskLike = {
  _id: mongoose.Types.ObjectId | string;
  name: string;
  meta?: string;
  completed: boolean;
  dayKey?: string | null;
  status?: string | null;
  order?: number;
  studyBlockId?: mongoose.Types.ObjectId | string | null;
  priority?: unknown;
  dueDate?: unknown;
  estimatedMinutes?: unknown;
};

export function toTaskResponse(task: TaskLike): TaskResponseBody {
  const { status, completed } = normalizeTaskState({
    status: typeof task.status === "string" ? task.status : undefined,
    completed: task.completed ?? false,
  });
  const { priority, dueDate, estimatedMinutes } = normalizeTaskFields(task);

  return {
    id: task._id.toString(),
    name: task.name,
    meta: task.meta || "",
    completed,
    dayKey: task.dayKey ?? null,
    status,
    order: task.order ?? 0,
    studyBlockId: task.studyBlockId ? task.studyBlockId.toString() : null,
    priority,
    dueDate,
    estimatedMinutes,
  };
}
