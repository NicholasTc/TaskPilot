import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TaskModel } from "@/models/Task";

const taskSortOrder = { completed: 1 as const, createdAt: -1 as const };

export async function GET() {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    await connectToDatabase();
    const tasks = await TaskModel.find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort(taskSortOrder)
      .lean();

    const response = tasks.map((task) => ({
      id: task._id.toString(),
      name: task.name,
      meta: task.meta || "",
      completed: task.completed,
    }));

    return NextResponse.json(response);
  } catch (error) {
    console.error("GET /api/tasks failed", error);
    return NextResponse.json({ error: "Failed to load tasks." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const meta = typeof body.meta === "string" ? body.meta.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "Task name is required." }, { status: 400 });
    }

    await connectToDatabase();
    const createdTask = await TaskModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      name,
      meta,
      completed: false,
    });

    return NextResponse.json(
      {
        id: createdTask._id.toString(),
        name: createdTask.name,
        meta: createdTask.meta || "",
        completed: createdTask.completed,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/tasks failed", error);
    return NextResponse.json({ error: "Failed to create task." }, { status: 500 });
  }
}
