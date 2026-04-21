/**
 * planDay — the main planner entry point.
 *
 * High-level algorithm:
 *
 *   1. NORMALIZE   — drop done tasks; fill in missing estimates with the
 *                    default; clamp to MIN_TASK_MINUTES.
 *   2. RESERVE     — honour `existingPlan`: locked blocks keep their slots
 *                    and count toward their parent task's scheduled total,
 *                    so re-running the planner is idempotent.
 *   3. SORT        — rank remaining tasks via `compareTasks`
 *                    (overdue > priority > due date > createdAt > id).
 *   4. SPLIT       — convert each task's remaining minutes into a list of
 *                    session lengths that each fit in one block.
 *   5. PLACE       — walk the planning horizon day by day; for each day
 *                    compute its free slots (after reserved blocks); fill
 *                    slots in chronological order with the next session
 *                    from the sorted task list.
 *   6. SUMMARIZE   — build per-task summaries, a planner-level summary,
 *                    and a human reason string for every placement.
 *
 * The engine is deterministic: given the same inputs, it always returns
 * the same `PlanResult`.
 */

import { DEFAULT_PLANNER_SETTINGS, MIN_TASK_MINUTES } from "./constants";
import { addDays, hhmmToMinutes, minutesToHhmm } from "./dates";
import { explainBlock, explainPlacement, explainUnscheduled } from "./explain";
import { sortTasks } from "./scoring";
import { generateDaySlots, type DaySlot } from "./slots";
import { splitIntoSessions } from "./splitting";
import type {
  GeneratedBlock,
  PlanDayInput,
  PlanResult,
  PlannedTaskSummary,
  PlannerSettings,
  PlannerSummary,
  PlannerTask,
  UnscheduledTask,
} from "./types";

export function planDay(input: PlanDayInput): PlanResult {
  const settings = mergeSettings(input.settings);
  const today = input.today;

  // Step 1 — normalize
  const { workable, skipped, usedDefaultIds } = normalizeTasks(
    input.tasks,
    settings,
  );

  // Step 2 — reserve locked blocks
  const reserved = (input.existingPlan ?? []).filter((b) => b.status !== "planned");
  const reservedByDay = groupBy(reserved, (b) => b.date);
  const minutesAlreadyScheduled = sumMinutesByTask(reserved);

  // Subtract already-scheduled minutes from each workable task
  const remainingByTask = new Map<string, number>();
  const originalEstimate = new Map<string, number>();
  for (const task of workable) {
    const est = Math.max(
      MIN_TASK_MINUTES,
      task.estimatedMinutes ?? settings.defaultTaskEstimateMinutes,
    );
    originalEstimate.set(task.id, est);
    const already = minutesAlreadyScheduled.get(task.id) ?? 0;
    remainingByTask.set(task.id, Math.max(0, est - already));
  }

  // Step 3 — sort
  const sorted = sortTasks(workable, today);

  // Step 4 + 5 — split each task into sessions and place them into
  // horizon days in order. We iterate tasks in priority order and, for
  // each task, drop its sessions into the earliest free slot across the
  // horizon (respecting per-day caps).
  const horizon = buildHorizon(today, settings.planningHorizonDays);
  const slotsTemplate = generateDaySlots(settings);
  const takenByDay = initTaken(horizon, reservedByDay);

  const placedBlocks: GeneratedBlock[] = [...reserved];
  const unscheduled: UnscheduledTask[] = [];
  const summaries: PlannedTaskSummary[] = [];

  for (const task of sorted) {
    const remaining = remainingByTask.get(task.id) ?? 0;
    const totalEstimate = originalEstimate.get(task.id) ?? 0;
    if (remaining <= 0) {
      summaries.push(
        buildSummary({
          task,
          totalMinutes: totalEstimate,
          sessionsPlaced: [],
          alreadyScheduledMinutes: minutesAlreadyScheduled.get(task.id) ?? 0,
          usedDefaultEstimate: usedDefaultIds.has(task.id),
          planStartDate: today,
        }),
      );
      continue;
    }

    const sessions = splitIntoSessions(remaining, settings.blockSizeMinutes);
    const placedForTask: GeneratedBlock[] = [];
    let unplacedMinutes = 0;

    for (let sIdx = 0; sIdx < sessions.length; sIdx += 1) {
      const sessionLength = sessions[sIdx];
      const placement = findNextFreeSlot(horizon, takenByDay, slotsTemplate);
      if (!placement) {
        // No remaining capacity anywhere in the horizon for this or
        // subsequent sessions of this task.
        unplacedMinutes += sessions.slice(sIdx).reduce((a, b) => a + b, 0);
        break;
      }

      const { date, slot } = placement;
      takenByDay.get(date)!.add(slot.slotIndex);

      const sessionDuration = Math.min(sessionLength, slot.durationMinutes);
      const endMinutes = slot.startMinutes + sessionDuration;

      placedForTask.push({
        id: `${date}-${slot.slotIndex}-${task.id}-${sIdx}`,
        date,
        startTime: slot.startTime,
        endTime: minutesToHhmm(endMinutes),
        durationMinutes: sessionDuration,
        taskId: task.id,
        taskTitle: task.title,
        sessionIndex: sIdx,
        sessionTotal: sessions.length,
        blockType: "focus",
        status: "planned",
        reason: explainBlock({
          task,
          sessionIndex: sIdx,
          sessionTotal: sessions.length,
          date,
          planStartDate: today,
        }),
      });
    }

    placedBlocks.push(...placedForTask);

    if (unplacedMinutes > 0) {
      unscheduled.push({
        taskId: task.id,
        title: task.title,
        remainingMinutes: unplacedMinutes,
        reason: explainUnscheduled(task, unplacedMinutes, settings.planningHorizonDays),
      });
    }

    summaries.push(
      buildSummary({
        task,
        totalMinutes: totalEstimate,
        sessionsPlaced: placedForTask,
        alreadyScheduledMinutes: minutesAlreadyScheduled.get(task.id) ?? 0,
        usedDefaultEstimate: usedDefaultIds.has(task.id),
        unscheduledMinutes: unplacedMinutes,
        planStartDate: today,
      }),
    );
  }

  // Also emit summaries for skipped (already-done) tasks so callers have
  // a complete picture. Their summary is trivial — zero new work.
  for (const task of skipped) {
    summaries.push({
      taskId: task.id,
      title: task.title,
      totalMinutes: 0,
      scheduledMinutes: 0,
      unscheduledMinutes: 0,
      scheduledSessions: 0,
      firstScheduledDate: null,
      lastScheduledDate: null,
      usedDefaultEstimate: false,
      reason: "Skipped — task is already done",
    });
  }

  // Chronological order is the most useful output shape for callers.
  placedBlocks.sort(compareBlocksChronologically);

  const plannerSummary = buildPlannerSummary({
    considered: workable.length + skipped.length,
    summaries,
    unscheduled,
    blocks: placedBlocks,
  });

  return {
    blocks: placedBlocks,
    unscheduledTasks: unscheduled,
    taskSummaries: summaries,
    plannerSummary,
  };
}

// ---------- helpers ----------

function mergeSettings(
  overrides: Partial<PlannerSettings> | undefined,
): PlannerSettings {
  return { ...DEFAULT_PLANNER_SETTINGS, ...(overrides ?? {}) };
}

function normalizeTasks(
  tasks: PlannerTask[],
  settings: PlannerSettings,
): {
  workable: PlannerTask[];
  skipped: PlannerTask[];
  usedDefaultIds: Set<string>;
} {
  const workable: PlannerTask[] = [];
  const skipped: PlannerTask[] = [];
  const usedDefaultIds = new Set<string>();

  for (const task of tasks) {
    if (task.status === "done") {
      skipped.push(task);
      continue;
    }
    let est = task.estimatedMinutes;
    if (est === null || est === undefined || !Number.isFinite(est)) {
      est = settings.defaultTaskEstimateMinutes;
      usedDefaultIds.add(task.id);
    }
    est = Math.max(MIN_TASK_MINUTES, Math.floor(est));
    workable.push({ ...task, estimatedMinutes: est });
  }

  return { workable, skipped, usedDefaultIds };
}

function buildHorizon(today: string, days: number): string[] {
  const horizon: string[] = [];
  for (let i = 0; i < days; i += 1) {
    horizon.push(addDays(today, i));
  }
  return horizon;
}

function initTaken(
  horizon: string[],
  reservedByDay: Map<string, GeneratedBlock[]>,
): Map<string, Set<number>> {
  const taken = new Map<string, Set<number>>();
  for (const day of horizon) {
    taken.set(day, new Set<number>());
  }
  // For reserved days outside the horizon (e.g., a locked block from the
  // past) we still track them so sumMinutesByTask is consistent, but we
  // won't walk them in findNextFreeSlot.
  for (const [day, blocks] of reservedByDay) {
    if (!taken.has(day)) taken.set(day, new Set<number>());
    const set = taken.get(day)!;
    for (const b of blocks) {
      // Reserved blocks may not have a slotIndex we can derive exactly,
      // but since we sort slots by startTime later we only need to mark
      // "this slot is taken" when it matches a template slot.
      // We conservatively reserve by start time.
      set.add(deriveSlotIndex(b.startTime));
    }
  }
  return taken;
}

/**
 * Derive a slot index purely from the block's start time. This keeps us
 * aligned when a reserved block was generated by this same engine (same
 * settings). If a reserved block doesn't align, `findNextFreeSlot` will
 * simply skip whatever template slot collides — no overlap possible
 * because we re-generate from the template and skip taken indexes.
 */
function deriveSlotIndex(startTime: string): number {
  // We only need a stable integer per start time — use minutes since
  // midnight as the "virtual" index. `findNextFreeSlot` only checks
  // membership so the exact value doesn't matter, as long as reserved
  // and template agree on the mapping (template uses its own 0-based
  // slotIndex). Callers that want perfect alignment should use the
  // Stage-2 adapters. For Stage 1 we simply reserve by minute offset:
  return hhmmToMinutes(startTime);
}

function findNextFreeSlot(
  horizon: string[],
  takenByDay: Map<string, Set<number>>,
  slotsTemplate: DaySlot[],
): { date: string; slot: DaySlot } | null {
  for (const date of horizon) {
    const taken = takenByDay.get(date)!;
    for (const slot of slotsTemplate) {
      // A slot is free if neither its template index nor its
      // minute-of-day marker is already claimed.
      if (taken.has(slot.slotIndex) || taken.has(slot.startMinutes)) continue;
      return { date, slot };
    }
  }
  return null;
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function sumMinutesByTask(blocks: GeneratedBlock[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of blocks) {
    out.set(b.taskId, (out.get(b.taskId) ?? 0) + b.durationMinutes);
  }
  return out;
}

function compareBlocksChronologically(a: GeneratedBlock, b: GeneratedBlock): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
  return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
}

function buildSummary(args: {
  task: PlannerTask;
  totalMinutes: number;
  sessionsPlaced: GeneratedBlock[];
  alreadyScheduledMinutes: number;
  usedDefaultEstimate: boolean;
  unscheduledMinutes?: number;
  planStartDate: string;
}): PlannedTaskSummary {
  const scheduledMinutes =
    args.sessionsPlaced.reduce((a, b) => a + b.durationMinutes, 0) +
    args.alreadyScheduledMinutes;
  const scheduledSessions = args.sessionsPlaced.length;
  const firstScheduledDate = args.sessionsPlaced[0]?.date ?? null;
  const lastScheduledDate =
    args.sessionsPlaced[args.sessionsPlaced.length - 1]?.date ?? null;

  return {
    taskId: args.task.id,
    title: args.task.title,
    totalMinutes: args.totalMinutes,
    scheduledMinutes,
    unscheduledMinutes: args.unscheduledMinutes ?? 0,
    scheduledSessions,
    firstScheduledDate,
    lastScheduledDate,
    usedDefaultEstimate: args.usedDefaultEstimate,
    reason: explainPlacement({
      task: args.task,
      firstScheduledDate: firstScheduledDate ?? args.planStartDate,
      planStartDate: args.planStartDate,
      usedDefaultEstimate: args.usedDefaultEstimate,
      wasSplit: scheduledSessions > 1,
      sessionTotal: scheduledSessions || 1,
    }),
  };
}

function buildPlannerSummary(args: {
  considered: number;
  summaries: PlannedTaskSummary[];
  unscheduled: UnscheduledTask[];
  blocks: GeneratedBlock[];
}): PlannerSummary {
  const scheduledTaskIds = new Set(
    args.summaries
      .filter((s) => s.scheduledSessions > 0)
      .map((s) => s.taskId),
  );

  const totalMinutesScheduled = args.blocks.reduce(
    (acc, b) => acc + b.durationMinutes,
    0,
  );

  const firstBlock = args.blocks[0];

  const workloadWarning = buildWorkloadWarning(args.unscheduled);

  return {
    totalTasksConsidered: args.considered,
    totalTasksScheduled: scheduledTaskIds.size,
    totalTasksUnscheduled: args.unscheduled.length,
    totalBlocksGenerated: args.blocks.length,
    totalMinutesScheduled,
    workloadWarning,
    suggestedNextTaskId: firstBlock?.taskId ?? null,
  };
}

function buildWorkloadWarning(unscheduled: UnscheduledTask[]): string | null {
  if (unscheduled.length === 0) return null;
  const minutes = unscheduled.reduce((a, b) => a + b.remainingMinutes, 0);
  const tasks = unscheduled.length;
  return `${tasks} task${tasks === 1 ? "" : "s"} (${minutes} min total) did not fit in the planning horizon. Consider lowering scope, extending the horizon, or raising day capacity.`;
}
