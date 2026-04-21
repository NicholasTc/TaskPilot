/**
 * Canonical parsing + normalization for the planner-driven task fields
 * (priority, dueDate, estimatedMinutes).
 *
 * Why this lives in `lib/` instead of inside each route:
 *   - Each of the four parsers has a tri-state contract (valid / clear /
 *     ignore) that is easy to get wrong when reimplemented per route.
 *   - Pulling them out lets us unit-test them without spinning up a DB
 *     or HTTP stack, and guarantees the board, tasks list, and PATCH
 *     handlers all accept / return exactly the same shapes.
 *
 * Convention used across every parser:
 *   - Returns `T`        → caller should set the field to this value.
 *   - Returns `null`     → caller should clear the field (if nullable).
 *   - Returns `undefined`→ input was invalid OR absent; caller should
 *                          leave the existing DB value alone.
 *
 * Callers typically check `body.someField !== undefined` first to decide
 * whether a parser was even asked to look at this field.
 */

export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const DEFAULT_TASK_PRIORITY: TaskPriority = "medium";

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isTaskPriority(value: unknown): value is TaskPriority {
  return (
    typeof value === "string" &&
    (TASK_PRIORITIES as readonly string[]).includes(value)
  );
}

export function parseTaskPriority(value: unknown): TaskPriority | undefined {
  if (isTaskPriority(value)) return value;
  return undefined;
}

/**
 * Accepts:
 *   - null or ""         → null (clear the due date)
 *   - "YYYY-MM-DD"       → Date at UTC midnight
 *   - full ISO timestamp → Date (parsed by Date)
 *   - anything else      → undefined (ignore)
 *
 * Storing as a Date keeps MongoDB indexes useful; when we hand the task
 * to the planner, the adapter converts it back to a "YYYY-MM-DD" string.
 */
export function parseDueDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (DAY_KEY_PATTERN.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(date.getTime())) return undefined;
    return date;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

/**
 * Minutes > 0, finite, integer. Anything else → undefined (ignore) or
 * null when the caller explicitly sends null.
 */
export function parseEstimatedMinutes(
  value: unknown,
): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded <= 0) return undefined;
  return rounded;
}

/**
 * Turn a stored Date back into the "YYYY-MM-DD" string the planner and
 * UI both expect. Returns null when the input is missing or invalid.
 */
export function dueDateToDayKey(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "string") {
    if (DAY_KEY_PATTERN.test(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return dueDateToDayKey(parsed);
  }
  return null;
}

/**
 * Read-path normalizer: given whatever the DB returned for these fields,
 * produce a clean, UI- and planner-friendly shape. Mirrors
 * `normalizeTaskState` in spirit.
 */
export function normalizeTaskFields(task: {
  priority?: unknown;
  dueDate?: unknown;
  estimatedMinutes?: unknown;
}): {
  priority: TaskPriority;
  dueDate: string | null;
  estimatedMinutes: number | null;
} {
  const priority = isTaskPriority(task.priority)
    ? task.priority
    : DEFAULT_TASK_PRIORITY;
  const dueDate = dueDateToDayKey(
    task.dueDate as Date | string | null | undefined,
  );
  const estimatedMinutes =
    typeof task.estimatedMinutes === "number" &&
    Number.isFinite(task.estimatedMinutes) &&
    task.estimatedMinutes > 0
      ? Math.round(task.estimatedMinutes)
      : null;

  return { priority, dueDate, estimatedMinutes };
}
