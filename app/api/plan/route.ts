/**
 * POST /api/plan — regenerate the user's focus-block schedule.
 *
 * Behavior (decided in Stage-4 design):
 *   - Mode: "replace" (idempotent). Previously-planned blocks from today
 *     forward are deleted and re-created; active/done blocks are preserved
 *     and fed back to the planner as `existingPlan` so their slots are
 *     reserved.
 *   - Task scope: all tasks whose status is not "done".
 *   - Response: the full PlanResult with block ids swapped to real DB _ids.
 *
 * Persistence sequence (non-transactional on purpose — dev MongoDB usually
 * runs standalone and does not support multi-document transactions):
 *
 *   1. Load tasks + existing future blocks.
 *   2. Split existing blocks into LOCKED (active/done) and STALE (planned).
 *   3. Run planDay(...) with LOCKED blocks as existingPlan.
 *   4. Delete the stale blocks that the new plan did not re-include.
 *   5. Insert the new blocks (ordered: true) so we can pair planner ids
 *      with persisted _ids by index.
 *   6. Bulk-update tasks: first-scheduled-block → studyBlockId + dayKey,
 *      promote backlog → planned, clear refs for unscheduled tasks.
 *
 * A failure partway through leaves the DB in a consistent (if stale)
 * state because deletions happen before insertions and task writeback
 * tolerates missing blocks. A follow-up /api/plan call will repair it.
 */

import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";

import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TaskModel } from "@/models/Task";
import { StudyBlockModel } from "@/models/StudyBlock";
import { toTaskResponse } from "@/lib/task-response";
import {
  buildBlockIdMap,
  buildTaskPatches,
  categorizeExistingBlocks,
  computeDeletions,
  computeInsertions,
  existingBlocksToGenerated,
  rewritePlanBlockIds,
  toStudyBlockPayloads,
  type ExistingBlockLike,
} from "@/lib/plan-service";
import {
  DEFAULT_PLANNER_SETTINGS,
  addDays,
  planDay,
  taskDocsToPlannerTasks,
  todayDayKey,
  type PlannerSettings,
  type PlannerTask,
  type TaskLike,
} from "@/planner";

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function mergeSettings(body: unknown): PlannerSettings {
  const overrides =
    body && typeof body === "object" && "settings" in body
      ? ((body as { settings?: unknown }).settings as Partial<PlannerSettings> | undefined)
      : undefined;
  if (!overrides || typeof overrides !== "object") {
    return { ...DEFAULT_PLANNER_SETTINGS };
  }
  const merged: PlannerSettings = { ...DEFAULT_PLANNER_SETTINGS };
  for (const key of Object.keys(DEFAULT_PLANNER_SETTINGS) as (keyof PlannerSettings)[]) {
    const raw = (overrides as Record<string, unknown>)[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      merged[key] = raw;
    }
  }
  return merged;
}

function parseTodayOverride(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { today?: unknown }).today;
  if (typeof raw !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine — caller can POST with no options.
    }

    const settings = mergeSettings(body);
    const today = parseTodayOverride(body) ?? todayDayKey();
    const horizonEnd = addDays(today, Math.max(1, settings.planningHorizonDays) - 1);

    await connectToDatabase();

    const ownerId = toObjectId(userId);

    // --- Step 1: Load tasks + existing future blocks. ---
    const [taskDocs, blockDocs] = await Promise.all([
      TaskModel.find({ userId: ownerId, status: { $ne: "done" } })
        .sort({ createdAt: 1 })
        .lean(),
      StudyBlockModel.find({
        userId: ownerId,
        dayKey: { $gte: today, $lte: horizonEnd },
      })
        .sort({ dayKey: 1, startMinutes: 1 })
        .lean(),
    ]);

    const tasks: PlannerTask[] = taskDocsToPlannerTasks(taskDocs as TaskLike[]);
    const taskTitleById = new Map<string, string>(
      tasks.map((t) => [t.id, t.title]),
    );

    const existingBlocks: ExistingBlockLike[] = blockDocs.map((doc) => {
      const activeTaskId = doc.activeTaskId ? String(doc.activeTaskId) : null;
      const title =
        (activeTaskId && taskTitleById.get(activeTaskId)) || doc.title || "Focus block";
      return {
        id: String(doc._id),
        dayKey: doc.dayKey,
        startMinutes: doc.startMinutes,
        durationMin: doc.durationMin,
        status: (doc.status ?? "planned") as ExistingBlockLike["status"],
        activeTaskId,
        taskTitle: title,
        reason: doc.reason ?? null,
      };
    });

    // --- Step 2: Categorize existing blocks. ---
    const { locked, stalePlanned } = categorizeExistingBlocks(existingBlocks);
    const existingPlan = existingBlocksToGenerated(locked);

    // --- Step 3: Run the planner. ---
    const result = planDay({ today, tasks, settings, existingPlan });

    // --- Step 4: Delete stale blocks that the new plan did not re-use. ---
    const deletions = computeDeletions(stalePlanned, result.blocks);
    if (deletions.length > 0) {
      await StudyBlockModel.deleteMany({
        userId: ownerId,
        _id: { $in: deletions.map(toObjectId) },
      });
    }

    // --- Step 5: Insert brand-new blocks and pair ids. ---
    const lockedIds = locked.map((b) => b.id);
    const insertions = computeInsertions(result, lockedIds);
    const insertPayloads = toStudyBlockPayloads(insertions, userId).map((p) => ({
      ...p,
      userId: ownerId,
      activeTaskId: p.activeTaskId ? toObjectId(p.activeTaskId) : null,
    }));

    const insertedDocs = insertPayloads.length
      ? await StudyBlockModel.insertMany(insertPayloads, { ordered: true })
      : [];

    const insertedPairs = insertions.map((block, i) => ({
      plannerBlockId: block.id,
      persistedId: String(insertedDocs[i]._id),
    }));

    const blockIdMap = buildBlockIdMap({
      insertedPairs,
      lockedBlockIds: lockedIds,
    });

    // --- Step 6: Task writeback. ---
    const patches = buildTaskPatches({ result, blockIdMap, tasks });
    if (patches.length > 0) {
      const bulkOps = patches.map((p) => ({
        updateOne: {
          filter: { _id: toObjectId(p.taskId), userId: ownerId },
          update: {
            $set: {
              status: p.status,
              dayKey: p.dayKey,
              studyBlockId: p.studyBlockId ? toObjectId(p.studyBlockId) : null,
            },
          },
        },
      }));
      await TaskModel.bulkWrite(bulkOps, { ordered: false });
    }

    // --- Build response. ---
    const persistedResult = rewritePlanBlockIds(result, blockIdMap);

    const refreshedTasks = await TaskModel.find({ userId: ownerId })
      .sort({ createdAt: 1 })
      .lean();

    return NextResponse.json({
      today,
      planningHorizonEnd: horizonEnd,
      settings,
      plan: persistedResult,
      tasks: refreshedTasks.map(toTaskResponse),
      deletedBlockIds: deletions,
      insertedBlockIds: insertedPairs.map((p) => p.persistedId),
      lockedBlockIds: lockedIds,
    });
  } catch (error) {
    console.error("POST /api/plan failed", error);
    return NextResponse.json({ error: "Failed to run planner." }, { status: 500 });
  }
}
