/**
 * Adapters between the planner engine and the app's MongoDB models.
 *
 * The planner itself is framework-agnostic (see `planner/types.ts`); the
 * Next.js app stores tasks and study blocks in Mongoose collections with
 * a slightly different shape. This file is the single place we translate
 * between the two worlds, so the engine stays clean and routes stay thin.
 *
 * Mapping summary:
 *
 *   Task (DB)                     ↔ PlannerTask
 *     _id              → id
 *     name             → title
 *     priority         → priority           (Stage 3 adds the field; default "medium")
 *     dueDate          → dueDate            (Stage 3 adds the field; default null)
 *     estimatedMinutes → estimatedMinutes   (Stage 3 adds the field; default null)
 *     status           → status (via normalizeTaskState)
 *     createdAt        → createdAt (ISO)
 *     dayKey           → scheduledDate
 *     studyBlockId     → scheduledBlockId
 *
 *   GeneratedBlock → StudyBlock payload
 *     date          → dayKey          ("YYYY-MM-DD")
 *     startTime     → startMinutes    (HH:mm → integer)
 *     durationMinutes → durationMin
 *     taskTitle     → title
 *     taskId        → activeTaskId
 *     status        → status
 *
 * These adapters are pure: they take plain objects, return plain objects,
 * and never touch the database.
 */

import type { TaskDocument, TaskStatus } from "@/models/Task";
import type { StudyBlockDocument, StudyBlockStatus } from "@/models/StudyBlock";
import { normalizeTaskState } from "@/lib/task-status";

import { hhmmToMinutes, minutesToHhmm } from "./dates";
import type {
  GeneratedBlock,
  PlannerTask,
  PlannerTaskStatus,
  TaskPriority,
} from "./types";

/**
 * Structural shape of a Task read from Mongo. We intentionally don't
 * depend on Mongoose's runtime types here so the adapter is easy to test
 * with plain objects.
 */
export type TaskLike = {
  _id: unknown;
  name: string;
  status?: string | null;
  completed?: boolean | null;
  dayKey?: string | null;
  studyBlockId?: unknown;
  createdAt?: Date | string | null;
  /** Stage 3 fields — currently optional so Stage 2 works against today's schema. */
  priority?: TaskPriority | string | null;
  dueDate?: Date | string | null;
  estimatedMinutes?: number | null;
};

export type StudyBlockPayload = {
  userId: string;
  dayKey: string;
  title: string;
  startMinutes: number;
  durationMin: number;
  status: StudyBlockStatus;
  activeTaskId: string | null;
  /** Planner's placement reason — empty string for blocks created outside the planner. */
  reason: string;
};

// ---------- Task (DB) → PlannerTask ----------

export function taskDocToPlannerTask(doc: TaskLike): PlannerTask {
  const normalized = normalizeTaskState({
    status: typeof doc.status === "string" ? doc.status : undefined,
    completed: doc.completed ?? false,
  });

  return {
    id: stringifyId(doc._id),
    title: doc.name,
    priority: normalizePriority(doc.priority),
    dueDate: toDayKeyOrNull(doc.dueDate),
    estimatedMinutes: normalizeEstimate(doc.estimatedMinutes),
    status: normalized.status as PlannerTaskStatus,
    createdAt: toIsoString(doc.createdAt) ?? new Date(0).toISOString(),
    scheduledDate: doc.dayKey ?? null,
    scheduledBlockId: doc.studyBlockId ? stringifyId(doc.studyBlockId) : null,
  };
}

/**
 * Convert many at once. Separate helper so call sites can stay terse.
 */
export function taskDocsToPlannerTasks(docs: TaskLike[]): PlannerTask[] {
  return docs.map(taskDocToPlannerTask);
}

// ---------- GeneratedBlock → StudyBlock payload ----------

/**
 * Prepares the fields needed to `StudyBlockModel.create(...)` one block.
 * Note: this never writes to the database — callers own persistence,
 * transactions, and error handling.
 */
export function generatedBlockToStudyBlockPayload(
  block: GeneratedBlock,
  userId: string,
): StudyBlockPayload {
  return {
    userId,
    dayKey: block.date,
    title: block.taskTitle,
    startMinutes: hhmmToMinutes(block.startTime),
    durationMin: block.durationMinutes,
    status: block.status,
    activeTaskId: block.taskId,
    reason: block.reason ?? "",
  };
}

export function generatedBlocksToStudyBlockPayloads(
  blocks: GeneratedBlock[],
  userId: string,
): StudyBlockPayload[] {
  return blocks.map((b) => generatedBlockToStudyBlockPayload(b, userId));
}

// ---------- StudyBlock (DB) → GeneratedBlock ----------

/**
 * Inverse of `generatedBlockToStudyBlockPayload` — used when we want to
 * hand existing DB blocks back to the planner as `existingPlan` (so the
 * planner can reserve their slots when re-planning).
 *
 * Reasons are intentionally generic here; once the planner has written a
 * block, its richer placement reason lives in memory only. Stage 4 will
 * persist reasons when we add the `/api/plan` route.
 */
export function studyBlockDocToGeneratedBlock(
  doc: StudyBlockLike,
  taskTitle: string,
): GeneratedBlock {
  const startTime = minutesToHhmm(doc.startMinutes);
  const endTime = minutesToHhmm(doc.startMinutes + doc.durationMin);
  return {
    id: stringifyId(doc._id),
    date: doc.dayKey,
    startTime,
    endTime,
    durationMinutes: doc.durationMin,
    taskId: doc.activeTaskId ? stringifyId(doc.activeTaskId) : "",
    taskTitle,
    sessionIndex: 0,
    sessionTotal: 1,
    blockType: "focus",
    status: (doc.status ?? "planned") as GeneratedBlock["status"],
    reason: doc.reason?.trim() ? doc.reason : "Existing block preserved from previous plan",
  };
}

export type StudyBlockLike = {
  _id: unknown;
  dayKey: string;
  title: string;
  startMinutes: number;
  durationMin: number;
  status?: StudyBlockStatus | string | null;
  activeTaskId?: unknown;
  reason?: string | null;
};

// ---------- internal normalizers ----------

function normalizePriority(value: unknown): TaskPriority {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function normalizeEstimate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return null;
}

function toDayKeyOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "string") {
    // Accept both "YYYY-MM-DD" and full ISO timestamps.
    return value.slice(0, 10);
  }
  return null;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return null;
}

function stringifyId(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof (value as { toString?: () => string }).toString === "function") {
    return (value as { toString: () => string }).toString();
  }
  return String(value);
}

// ---------- re-export types a route handler will likely want ----------

export type { TaskStatus, StudyBlockStatus };
export type { TaskDocument, StudyBlockDocument };
