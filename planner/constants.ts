import type { PlannerSettings, TaskPriority } from "./types";

/**
 * Sensible defaults for a first-pass planner. These mirror the product
 * spec: 10:00–18:00 workday, 60-minute focus blocks with 10-minute
 * breaks, capped at 4 deep-work blocks per day, planning a week ahead.
 */
export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  dayStartHour: 10,
  dayEndHour: 18,
  blockSizeMinutes: 60,
  shortBreakMinutes: 10,
  maxFocusBlocksPerDay: 4,
  defaultTaskEstimateMinutes: 60,
  planningHorizonDays: 7,
};

/**
 * Priority → numeric weight used during sorting.
 * "Overdue" tasks get promoted above "high" in the scheduler.
 */
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Extra weight added when a task is past its due date. */
export const OVERDUE_BONUS = 2;

/** Clamp floor for estimated minutes — we never schedule a session shorter than this. */
export const MIN_TASK_MINUTES = 15;
