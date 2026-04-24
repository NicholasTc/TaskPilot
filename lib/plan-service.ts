/**
 * Plan service — pure orchestration helpers for `POST /api/plan`.
 *
 * The route handler is deliberately thin. All decisions about which DB
 * blocks get deleted, which get inserted, and which tasks get patched
 * live here so they are unit-testable without a live MongoDB.
 *
 * The flow is:
 *
 *   1. Load tasks + existing future blocks.
 *   2. `categorizeExistingBlocks` splits existing blocks into LOCKED
 *      (active/done → feed back into planner) and STALE (previously
 *      planned → candidates for deletion).
 *   3. `planDay(...)` runs with the locked blocks as `existingPlan`.
 *   4. `computeDeletions` picks stale blocks that the new plan did not
 *      regenerate; the route deletes these from Mongo.
 *   5. `computeInsertions` picks NEW blocks in the plan; the route
 *      inserts them. Insert order is preserved so we can map back.
 *   6. `buildTaskPatches` translates the plan into task-level writes:
 *      each task gets its first scheduled block's persisted id,
 *      the corresponding dayKey, and a status bump from backlog→planned.
 *
 * Every helper is deterministic and takes plain data.
 */

import type {
  GeneratedBlock,
  PlanResult,
  PlannerTask,
  PlannerTaskStatus,
} from "@/planner/types";
import {
  generatedBlockToStudyBlockPayload,
  type StudyBlockPayload,
} from "@/planner/adapters";

// ----------------------- existing-block categorization ----------------------

export type ExistingBlockLike = {
  id: string;
  dayKey: string;
  startMinutes: number;
  durationMin: number;
  status: "planned" | "active" | "done";
  activeTaskId: string | null;
  taskTitle: string;
  /** Previous planner reason, if any. Passes through so we don't wipe it on re-plan. */
  reason?: string | null;
};

export type CategorizedBlocks = {
  /** Status active/done — cannot be moved; fed as `existingPlan` to planner. */
  locked: ExistingBlockLike[];
  /** Status planned — prior planner output that may be replaced. */
  stalePlanned: ExistingBlockLike[];
};

export function categorizeExistingBlocks(
  blocks: ExistingBlockLike[],
): CategorizedBlocks {
  const locked: ExistingBlockLike[] = [];
  const stalePlanned: ExistingBlockLike[] = [];
  for (const b of blocks) {
    if (b.status === "planned") stalePlanned.push(b);
    else locked.push(b);
  }
  return { locked, stalePlanned };
}

/**
 * Turn locked DB blocks into `GeneratedBlock` shapes so the planner can
 * reserve their slots. We deliberately stamp the DB id as the
 * GeneratedBlock id — this lets us distinguish "already persisted" from
 * "newly generated" after `planDay()` returns.
 */
export function existingBlocksToGenerated(
  blocks: ExistingBlockLike[],
): GeneratedBlock[] {
  return blocks.map((b) => {
    const startTime = minutesToHhmm(b.startMinutes);
    const endTime = minutesToHhmm(b.startMinutes + b.durationMin);
    return {
      id: b.id,
      date: b.dayKey,
      startTime,
      endTime,
      durationMinutes: b.durationMin,
      taskId: b.activeTaskId ?? "",
      taskTitle: b.taskTitle,
      sessionIndex: 0,
      sessionTotal: 1,
      blockType: "focus",
      status: b.status,
      reason: b.reason?.trim() ? b.reason : "Existing block preserved from previous plan",
    };
  });
}

// ----------------------- post-plan reconciliation ---------------------------

/**
 * Which stale-planned blocks should be deleted? Anything in the stale set
 * whose DB id does not appear in the new plan's block list.
 */
export function computeDeletions(
  stalePlanned: ExistingBlockLike[],
  planBlocks: GeneratedBlock[],
): string[] {
  const planIds = new Set(planBlocks.map((b) => b.id));
  return stalePlanned.filter((b) => !planIds.has(b.id)).map((b) => b.id);
}

/**
 * Which plan blocks are NEW (i.e., not in the locked set)? These need to
 * be inserted as StudyBlock documents. Returned order is chronological
 * (the caller relies on `insertMany(ordered: true)` matching this order
 * so we can build a plannerId→persistedId map).
 */
export function computeInsertions(
  result: PlanResult,
  existingBlockIds: Iterable<string>,
): GeneratedBlock[] {
  const existing = new Set(existingBlockIds);
  return result.blocks.filter((b) => !existing.has(b.id));
}

export function toStudyBlockPayloads(
  blocks: GeneratedBlock[],
  userId: string,
): StudyBlockPayload[] {
  return blocks.map((b) => generatedBlockToStudyBlockPayload(b, userId));
}

// ----------------------- task writeback -------------------------------------

export type TaskPatch = {
  taskId: string;
  status: PlannerTaskStatus;
  dayKey: string | null;
  studyBlockId: string | null;
};

/**
 * Given the plan result and a plannerBlockId → persistedBlockId map,
 * produce the set of task patches the route should bulk-write.
 *
 * Rules:
 *   - If the task was scheduled, its first chronological block decides
 *     `dayKey` + `studyBlockId`. Status goes to "planned" when it was
 *     "backlog"; "in_progress" / "done" are left alone.
 *   - If the task was NOT scheduled (unscheduled / skipped), we clear
 *     `dayKey` + `studyBlockId` to avoid dangling references.
 *
 * Tasks already tied to a locked (active/done) block keep their
 * existing studyBlockId — the id map will hand it back unchanged.
 */
export function buildTaskPatches(params: {
  result: PlanResult;
  blockIdMap: Map<string, string>;
  tasks: PlannerTask[];
}): TaskPatch[] {
  const { result, blockIdMap, tasks } = params;

  // Chronologically-first block per task.
  const firstBlockByTask = new Map<string, GeneratedBlock>();
  for (const b of result.blocks) {
    if (!b.taskId) continue;
    if (!firstBlockByTask.has(b.taskId)) {
      firstBlockByTask.set(b.taskId, b);
    }
  }

  const patches: TaskPatch[] = [];
  for (const task of tasks) {
    if (task.status === "done") continue; // never touched
    const firstBlock = firstBlockByTask.get(task.id);
    if (firstBlock) {
      const persistedId = blockIdMap.get(firstBlock.id) ?? firstBlock.id;
      patches.push({
        taskId: task.id,
        status: task.status === "backlog" ? "planned" : task.status,
        dayKey: firstBlock.date,
        studyBlockId: persistedId,
      });
    } else {
      patches.push({
        taskId: task.id,
        status: task.status, // unchanged
        dayKey: null,
        studyBlockId: null,
      });
    }
  }
  return patches;
}

/**
 * Build the plannerBlockId → persistedBlockId map. For locked blocks the
 * two are identical (planner was seeded with the DB id). For newly
 * inserted blocks the caller pairs the planner-generated block and the
 * persisted document by insertion order.
 */
export function buildBlockIdMap(params: {
  insertedPairs: Array<{ plannerBlockId: string; persistedId: string }>;
  lockedBlockIds: Iterable<string>;
}): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of params.lockedBlockIds) map.set(id, id);
  for (const { plannerBlockId, persistedId } of params.insertedPairs) {
    map.set(plannerBlockId, persistedId);
  }
  return map;
}

/**
 * Return a new PlanResult where every block id has been rewritten to
 * the persisted DB id, so callers (API consumers, UI) see real ids.
 */
export function rewritePlanBlockIds(
  result: PlanResult,
  blockIdMap: Map<string, string>,
): PlanResult {
  return {
    ...result,
    blocks: result.blocks.map((b) => ({
      ...b,
      id: blockIdMap.get(b.id) ?? b.id,
    })),
    plannerSummary: { ...result.plannerSummary },
  };
}

// ---------------------------------------------------------------------------

function minutesToHhmm(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.floor(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
