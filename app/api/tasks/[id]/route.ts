import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TASK_STATUSES, TaskModel } from "@/models/Task";
import { StudyBlockModel } from "@/models/StudyBlock";
import { resolveTaskState } from "@/lib/task-status";
import { toTaskResponse } from "@/lib/task-response";
import {
  parseDueDate,
  parseEstimatedMinutes,
  parseTaskPriority,
} from "@/lib/task-fields";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isInvalidObjectId(id: string) {
  return !mongoose.Types.ObjectId.isValid(id);
}

const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function parseTaskStatus(value: unknown) {
  if (typeof value !== "string") return null;
  return TASK_STATUSES.includes(value as (typeof TASK_STATUSES)[number])
    ? (value as (typeof TASK_STATUSES)[number])
    : null;
}

function parseDayKey(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return dayKeyPattern.test(trimmed) ? trimmed : undefined;
}

function parseOrder(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function parseStudyBlockId(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (!value.trim()) return null;
  if (!mongoose.Types.ObjectId.isValid(value)) return undefined;
  return value;
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (isInvalidObjectId(id)) {
      return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
    }

    await connectToDatabase();
    const userObjectId = toObjectId(userId);
    const deletedTask = await TaskModel.findOneAndDelete({
      _id: toObjectId(id),
      userId: userObjectId,
    });

    if (!deletedTask) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    // If this task belonged to a study block, keep block/task linkage clean:
    // - remove the whole block when this was its only linked task
    // - otherwise clear activeTaskId when it pointed at the deleted task
    if (deletedTask.studyBlockId) {
      const blockId = deletedTask.studyBlockId;
      const remainingLinkedTasks = await TaskModel.countDocuments({
        userId: userObjectId,
        studyBlockId: blockId,
        _id: { $ne: deletedTask._id },
      });

      if (remainingLinkedTasks === 0) {
        await StudyBlockModel.findOneAndDelete({
          _id: blockId,
          userId: userObjectId,
        });
      } else {
        await StudyBlockModel.findOneAndUpdate(
          { _id: blockId, userId: userObjectId, activeTaskId: deletedTask._id },
          { $set: { activeTaskId: null } },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/tasks/${id} failed`, error);
    return NextResponse.json({ error: "Failed to delete task." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (isInvalidObjectId(id)) {
      return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const hasCompleted = typeof body.completed === "boolean";
    const hasStatus = body.status !== undefined;
    const hasDayKey = body.dayKey !== undefined;
    const hasOrder = body.order !== undefined;
    const hasStudyBlockId = body.studyBlockId !== undefined;
    const hasPriority = body.priority !== undefined;
    const hasDueDate = body.dueDate !== undefined;
    const hasEstimatedMinutes = body.estimatedMinutes !== undefined;

    const parsedStatus = parseTaskStatus(body.status);
    const parsedDayKey = parseDayKey(body.dayKey);
    const parsedOrder = parseOrder(body.order);
    const parsedStudyBlockId = parseStudyBlockId(body.studyBlockId);
    const parsedPriority = parseTaskPriority(body.priority);
    const parsedDueDate = parseDueDate(body.dueDate);
    const parsedEstimatedMinutes = parseEstimatedMinutes(body.estimatedMinutes);

    if (hasStatus && !parsedStatus) {
      return NextResponse.json({ error: "Invalid task status." }, { status: 400 });
    }

    if (hasDayKey && parsedDayKey === undefined) {
      return NextResponse.json(
        { error: "Invalid dayKey. Expected format YYYY-MM-DD." },
        { status: 400 },
      );
    }

    if (hasOrder && parsedOrder === undefined) {
      return NextResponse.json({ error: "Invalid order value." }, { status: 400 });
    }

    if (hasStudyBlockId && parsedStudyBlockId === undefined) {
      return NextResponse.json({ error: "Invalid studyBlockId." }, { status: 400 });
    }

    if (hasPriority && parsedPriority === undefined) {
      return NextResponse.json(
        { error: "Invalid priority. Expected low | medium | high." },
        { status: 400 },
      );
    }

    if (hasDueDate && parsedDueDate === undefined) {
      return NextResponse.json(
        { error: "Invalid dueDate. Expected null or YYYY-MM-DD / ISO string." },
        { status: 400 },
      );
    }

    if (hasEstimatedMinutes && parsedEstimatedMinutes === undefined) {
      return NextResponse.json(
        { error: "Invalid estimatedMinutes. Expected a positive integer or null." },
        { status: 400 },
      );
    }

    await connectToDatabase();
    const existing = await TaskModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });

    if (!existing) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    const { status: nextStatus, completed: nextCompleted } = resolveTaskState(
      { status: existing.status, completed: existing.completed },
      {
        status: hasStatus ? parsedStatus : undefined,
        completed: hasCompleted ? (body.completed as boolean) : undefined,
      },
    );
    existing.status = nextStatus;
    existing.completed = nextCompleted;

    if (hasDayKey) {
      existing.dayKey = parsedDayKey ?? null;
    }

    if (hasOrder) {
      existing.order = parsedOrder ?? existing.order;
    }

    if (hasStudyBlockId) {
      existing.studyBlockId = parsedStudyBlockId ? toObjectId(parsedStudyBlockId) : null;
    }

    if (hasPriority && parsedPriority) {
      existing.priority = parsedPriority;
    }

    if (hasDueDate) {
      existing.dueDate = parsedDueDate ?? null;
    }

    if (hasEstimatedMinutes) {
      existing.estimatedMinutes = parsedEstimatedMinutes ?? null;
    }

    if (nextCompleted && !existing.meta) {
      existing.meta = "Completed just now";
    }

    await existing.save();

    return NextResponse.json(toTaskResponse(existing));
  } catch (error) {
    console.error(`PATCH /api/tasks/${id} failed`, error);
    return NextResponse.json({ error: "Failed to update task." }, { status: 500 });
  }
}
