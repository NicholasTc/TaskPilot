/**
 * TaskPilot planner engine — public surface.
 *
 * Usage:
 *   import { planDay, DEFAULT_PLANNER_SETTINGS } from "@/planner";
 *
 *   const result = planDay({
 *     today: "2026-04-20",
 *     tasks: [...],
 *     settings: { maxFocusBlocksPerDay: 3 },
 *   });
 */

export * from "./types";
export { DEFAULT_PLANNER_SETTINGS, PRIORITY_WEIGHT, MIN_TASK_MINUTES } from "./constants";
export { planDay } from "./scheduler";
export { sortTasks, scoreTask, compareTasks } from "./scoring";
export { splitIntoSessions } from "./splitting";
export { generateDaySlots } from "./slots";
export type { DaySlot } from "./slots";
export {
  hhmmToMinutes,
  minutesToHhmm,
  addDays,
  isValidDayKey,
  isValidTime,
  todayDayKey,
  compareDayKeys,
} from "./dates";
export {
  taskDocToPlannerTask,
  taskDocsToPlannerTasks,
  generatedBlockToStudyBlockPayload,
  generatedBlocksToStudyBlockPayloads,
  studyBlockDocToGeneratedBlock,
} from "./adapters";
export type {
  TaskLike,
  StudyBlockLike,
  StudyBlockPayload,
} from "./adapters";
