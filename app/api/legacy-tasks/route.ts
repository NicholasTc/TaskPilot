import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TaskModel } from "@/models/Task";

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

export async function GET() {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    await connectToDatabase();
    const userObjectId = toObjectId(userId);

    const filter = {
      userId: userObjectId,
      $or: [{ dayKey: { $exists: false } }, { dayKey: null }, { dayKey: "" }],
    };

    const [count, tasks] = await Promise.all([
      TaskModel.countDocuments(filter),
      TaskModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);

    return NextResponse.json({
      count,
      tasks: tasks.map((task) => ({
        id: task._id.toString(),
        name: task.name,
        meta: task.meta || "",
        completed: task.completed,
        createdAt: task.createdAt?.toISOString?.() ?? null,
      })),
    });
  } catch (error) {
    console.error("GET /api/legacy-tasks failed", error);
    return NextResponse.json({ error: "Failed to load legacy tasks." }, { status: 500 });
  }
}
