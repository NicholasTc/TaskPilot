import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TASK_STATUSES, TaskModel } from "@/models/Task";

type ReorderItem = {
  id: string;
  status: (typeof TASK_STATUSES)[number];
  order: number;
  dayKey: string;
};

const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function isValidReorderItem(item: unknown): item is ReorderItem {
  if (!item || typeof item !== "object") return false;
  const typed = item as Record<string, unknown>;

  return (
    typeof typed.id === "string" &&
    mongoose.Types.ObjectId.isValid(typed.id) &&
    typeof typed.status === "string" &&
    TASK_STATUSES.includes(typed.status as (typeof TASK_STATUSES)[number]) &&
    typeof typed.order === "number" &&
    Number.isFinite(typed.order) &&
    typeof typed.dayKey === "string" &&
    dayKeyPattern.test(typed.dayKey)
  );
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const rawUpdates = Array.isArray(body?.updates) ? body.updates : null;
    if (!rawUpdates || rawUpdates.length === 0) {
      return NextResponse.json({ error: "updates array is required." }, { status: 400 });
    }

    if (!rawUpdates.every(isValidReorderItem)) {
      return NextResponse.json({ error: "Invalid reorder payload." }, { status: 400 });
    }
    const updates = rawUpdates as ReorderItem[];

    await connectToDatabase();
    const userObjectId = toObjectId(userId);
    const operations = updates.map((update) => ({
      updateOne: {
        filter: { _id: toObjectId(update.id), userId: userObjectId },
        update: {
          $set: {
            status: update.status,
            order: update.order,
            dayKey: update.dayKey,
            completed: update.status === "done",
          },
        },
      },
    }));

    const result = await TaskModel.bulkWrite(operations, { ordered: false });

    return NextResponse.json({
      success: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("POST /api/tasks/reorder failed", error);
    return NextResponse.json({ error: "Failed to reorder tasks." }, { status: 500 });
  }
}
