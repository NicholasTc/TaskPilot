import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TASK_STATUSES, TaskModel } from "@/models/Task";
import { normalizeTaskState } from "@/lib/task-status";

const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function isValidDayKey(value: string | null) {
  return !!value && dayKeyPattern.test(value);
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
  const { status, completed } = normalizeTaskState(task);
  return {
    id: task._id.toString(),
    name: task.name,
    meta: task.meta || "",
    completed,
    dayKey: task.dayKey ?? null,
    status,
    order: task.order ?? 0,
    studyBlockId: task.studyBlockId ? task.studyBlockId.toString() : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const dayKey = request.nextUrl.searchParams.get("day");
    if (!isValidDayKey(dayKey)) {
      return NextResponse.json(
        { error: "Missing or invalid day query parameter. Expected YYYY-MM-DD." },
        { status: 400 },
      );
    }

    await connectToDatabase();
    const tasks = await TaskModel.find({
      userId: toObjectId(userId),
      dayKey,
    })
      .sort({ status: 1, order: 1, createdAt: 1 })
      .lean();

    const tasksByStatus = Object.fromEntries(
      TASK_STATUSES.map((status) => [status, [] as ReturnType<typeof toTaskResponse>[]]),
    );

    for (const task of tasks) {
      const mappedTask = toTaskResponse(task);
      tasksByStatus[mappedTask.status].push(mappedTask);
    }

    return NextResponse.json({
      dayKey,
      tasksByStatus,
      totals: {
        all: tasks.length,
        done: tasksByStatus.done.length,
      },
    });
  } catch (error) {
    console.error("GET /api/board failed", error);
    return NextResponse.json({ error: "Failed to load board data." }, { status: 500 });
  }
}
