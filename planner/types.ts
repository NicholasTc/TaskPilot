/**
 * Planner engine — public types.
 *
 * The planner is a pure TypeScript module: it takes plain task records +
 * settings in, and returns a plan. It knows nothing about React, Next.js,
 * or MongoDB. Adapters (see `planner/adapters.ts`) bridge these types to
 * the app's database models.
 *
 * Time is represented as local-date strings throughout:
 *   date:      "YYYY-MM-DD"
 *   startTime: "HH:mm"  (24h, zero-padded)
 *
 * This keeps the engine timezone-agnostic and deterministic — callers
 * decide what "today" means, then pass that string in.
 */

export type TaskPriority = "low" | "medium" | "high";

export type PlannerTaskStatus =
  | "backlog"
  | "planned"
  | "in_progress"
  | "done";

/**
 * Input task to the planner. This is intentionally decoupled from any
 * ORM type; adapters convert DB docs into this shape.
 */
export type PlannerTask = {
  id: string;
  title: string;
  priority: TaskPriority;
  /** Local date "YYYY-MM-DD" or null. */
  dueDate: string | null;
  /** Minutes the user estimates this task will take. null → use default. */
  estimatedMinutes: number | null;
  status: PlannerTaskStatus;
  /** ISO 8601 timestamp used only as a deterministic tie-breaker. */
  createdAt: string;
  /** Previously-assigned date, if any. Informational only. */
  scheduledDate: string | null;
  /** Previously-assigned block id, if any. Informational only. */
  scheduledBlockId: string | null;
};

export type PlannerSettings = {
  /** Hour of day the focus window opens (0-23). */
  dayStartHour: number;
  /** Hour of day the focus window closes (0-24). */
  dayEndHour: number;
  /** Length of a single focus block, in minutes. */
  blockSizeMinutes: number;
  /** Break inserted between consecutive blocks, in minutes. */
  shortBreakMinutes: number;
  /** Hard ceiling on focus blocks scheduled per day. */
  maxFocusBlocksPerDay: number;
  /** Used when a task has no estimatedMinutes. */
  defaultTaskEstimateMinutes: number;
  /** How many days forward (including today) the planner may use. */
  planningHorizonDays: number;
};

export type GeneratedBlockStatus = "planned" | "active" | "done";

/**
 * A single focus block placed on the calendar by the planner.
 * One block = one task session (by product decision).
 */
export type GeneratedBlock = {
  /** Deterministic id: `${date}-${slotIndex}-${taskId}-${sessionIndex}`. */
  id: string;
  /** Local date "YYYY-MM-DD". */
  date: string;
  /** "HH:mm" start time, zero-padded. */
  startTime: string;
  /** "HH:mm" end time, zero-padded. */
  endTime: string;
  durationMinutes: number;
  taskId: string;
  taskTitle: string;
  /** 0-based session index for this task (0 is the first block of the task). */
  sessionIndex: number;
  /** Total sessions the task was split into. */
  sessionTotal: number;
  blockType: "focus";
  status: GeneratedBlockStatus;
  /** Human-readable reason for this placement. */
  reason: string;
};

export type UnscheduledTask = {
  taskId: string;
  title: string;
  /** Minutes that could not be placed within the planning horizon. */
  remainingMinutes: number;
  reason: string;
};

export type PlannedTaskSummary = {
  taskId: string;
  title: string;
  /** Post-clamp estimated total, including any used default. */
  totalMinutes: number;
  scheduledMinutes: number;
  unscheduledMinutes: number;
  /** Total number of scheduled sessions (blocks) for this task. */
  scheduledSessions: number;
  firstScheduledDate: string | null;
  lastScheduledDate: string | null;
  usedDefaultEstimate: boolean;
  reason: string;
};

export type PlannerSummary = {
  totalTasksConsidered: number;
  totalTasksScheduled: number;
  totalTasksUnscheduled: number;
  totalBlocksGenerated: number;
  totalMinutesScheduled: number;
  /**
   * Populated when some work spilled off the planning horizon, so the UI can
   * surface a "you're over capacity this week" nudge.
   */
  workloadWarning: string | null;
  /**
   * The task the user should tackle first — derived from the first scheduled
   * block (chronologically). Null when nothing was scheduled.
   */
  suggestedNextTaskId: string | null;
};

export type PlanResult = {
  blocks: GeneratedBlock[];
  unscheduledTasks: UnscheduledTask[];
  taskSummaries: PlannedTaskSummary[];
  plannerSummary: PlannerSummary;
};

export type PlanDayInput = {
  tasks: PlannerTask[];
  /** Partial overrides; unspecified fields fall back to DEFAULT_PLANNER_SETTINGS. */
  settings?: Partial<PlannerSettings>;
  /**
   * The date the planner treats as "today" ("YYYY-MM-DD"). Required so the
   * engine stays deterministic and timezone-independent — callers decide
   * what "today" means.
   */
  today: string;
  /**
   * Blocks that already exist and must not move (e.g. an active or done
   * session from an earlier plan). Their time slots are reserved and their
   * minutes count toward their parent task's scheduled total, so re-running
   * the planner is safe.
   */
  existingPlan?: GeneratedBlock[];
};
