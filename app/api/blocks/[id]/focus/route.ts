import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { applyElapsedAndPauseIfNeeded, getRemainingSeconds } from "@/lib/focus-timer";
import { connectToDatabase } from "@/lib/db";
import { StudyBlockModel } from "@/models/StudyBlock";
import { TaskModel } from "@/models/Task";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isInvalidObjectId(id: string) {
  return !mongoose.Types.ObjectId.isValid(id);
}

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (isInvalidObjectId(id)) {
      return NextResponse.json({ error: "Invalid block id." }, { status: 400 });
    }

    await connectToDatabase();

    const block = await StudyBlockModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });
    if (!block) {
      return NextResponse.json({ error: "Study block not found." }, { status: 404 });
    }

    applyElapsedAndPauseIfNeeded(block);
    if (block.isModified()) {
      await block.save();
    }

    const tasks = await TaskModel.find({
      userId: toObjectId(userId),
      dayKey: block.dayKey,
      studyBlockId: block._id,
    })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    return NextResponse.json({
      block: {
        id: block._id.toString(),
        dayKey: block.dayKey,
        title: block.title,
        startMinutes: block.startMinutes,
        durationMin: block.durationMin,
        status: block.status,
        timerState: block.timerState,
        remainingSeconds: block.remainingSeconds,
        effectiveRemainingSeconds: getRemainingSeconds(block),
        runningSince: block.runningSince ? block.runningSince.toISOString() : null,
        activeTaskId: block.activeTaskId ? block.activeTaskId.toString() : null,
      },
      tasks: tasks.map((task) => ({
        id: task._id.toString(),
        name: task.name,
        meta: task.meta || "",
        completed: task.completed,
        status: task.status ?? (task.completed ? "done" : "planned"),
        dayKey: task.dayKey ?? null,
        order: task.order ?? 0,
        studyBlockId: task.studyBlockId ? task.studyBlockId.toString() : null,
      })),
    });
  } catch (error) {
    console.error(`GET /api/blocks/${id}/focus failed`, error);
    return NextResponse.json({ error: "Failed to load focus block." }, { status: 500 });
  }
}

