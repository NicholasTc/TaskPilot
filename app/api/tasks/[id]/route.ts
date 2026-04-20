import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TASK_STATUSES, TaskModel } from "@/models/Task";

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

function toTaskResponse(task: {
  _id: mongoose.Types.ObjectId | string;
  name: string;
  meta?: string;
  completed: boolean;
  dayKey?: string | null;
  status?: string;
  order?: number;
  studyBlockId?: mongoose.Types.ObjectId | string | null;
}) {
  return {
    id: task._id.toString(),
    name: task.name,
    meta: task.meta || "",
    completed: task.completed,
    dayKey: task.dayKey ?? null,
    status: task.status ?? (task.completed ? "done" : "backlog"),
    order: task.order ?? 0,
    studyBlockId: task.studyBlockId ? task.studyBlockId.toString() : null,
  };
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
    const deletedTask = await TaskModel.findOneAndDelete({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });

    if (!deletedTask) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
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

    const parsedStatus = parseTaskStatus(body.status);
    const parsedDayKey = parseDayKey(body.dayKey);
    const parsedOrder = parseOrder(body.order);
    const parsedStudyBlockId = parseStudyBlockId(body.studyBlockId);

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

    await connectToDatabase();
    const existing = await TaskModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });

    if (!existing) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    const nextCompleted =
      hasCompleted
        ? body.completed
        : hasStatus
          ? parsedStatus === "done"
          : !existing.completed;
    existing.completed = nextCompleted;
    const nextStatus: (typeof TASK_STATUSES)[number] =
      hasStatus && parsedStatus
        ? parsedStatus
        : nextCompleted
          ? "done"
          : existing.status === "done"
            ? "planned"
            : existing.status || "backlog";
    existing.status = nextStatus;

    if (hasDayKey) {
      existing.dayKey = parsedDayKey ?? null;
    }

    if (hasOrder) {
      existing.order = parsedOrder ?? existing.order;
    }

    if (hasStudyBlockId) {
      existing.studyBlockId = parsedStudyBlockId ? toObjectId(parsedStudyBlockId) : null;
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
