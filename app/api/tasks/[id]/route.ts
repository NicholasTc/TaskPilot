import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TaskModel } from "@/models/Task";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isInvalidObjectId(id: string) {
  return !mongoose.Types.ObjectId.isValid(id);
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
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(userId),
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

    const body = await request.json().catch(() => ({}));
    const hasCompleted = typeof body.completed === "boolean";

    await connectToDatabase();
    const existing = await TaskModel.findOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!existing) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    const nextCompleted = hasCompleted ? body.completed : !existing.completed;
    existing.completed = nextCompleted;

    if (nextCompleted && !existing.meta) {
      existing.meta = "Completed just now";
    }

    await existing.save();

    return NextResponse.json({
      id: existing._id.toString(),
      name: existing.name,
      meta: existing.meta || "",
      completed: existing.completed,
    });
  } catch (error) {
    console.error(`PATCH /api/tasks/${id} failed`, error);
    return NextResponse.json({ error: "Failed to update task." }, { status: 500 });
  }
}
