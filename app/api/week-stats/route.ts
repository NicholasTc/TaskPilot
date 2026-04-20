import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TaskModel } from "@/models/Task";

const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const oneDayMs = 24 * 60 * 60 * 1000;

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function toDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, dayCount: number) {
  return new Date(date.getTime() + oneDayMs * dayCount);
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const start = request.nextUrl.searchParams.get("start");
    if (!start || !dayKeyPattern.test(start)) {
      return NextResponse.json(
        { error: "Missing or invalid start query parameter. Expected YYYY-MM-DD." },
        { status: 400 },
      );
    }

    const startDate = new Date(`${start}T00:00:00.000Z`);
    if (Number.isNaN(startDate.getTime())) {
      return NextResponse.json({ error: "Invalid start date." }, { status: 400 });
    }

    const dayKeys = Array.from({ length: 7 }, (_, index) => toDayKey(addDays(startDate, index)));

    await connectToDatabase();
    const aggregates = await TaskModel.aggregate<{
      _id: string;
      total: number;
      done: number;
    }>([
      {
        $match: {
          userId: toObjectId(userId),
          dayKey: { $in: dayKeys },
        },
      },
      {
        $group: {
          _id: "$dayKey",
          total: { $sum: 1 },
          done: {
            $sum: {
              $cond: [{ $eq: ["$status", "done"] }, 1, 0],
            },
          },
        },
      },
    ]);

    const byDay = new Map(aggregates.map((item) => [item._id, item]));
    const days = dayKeys.map((dayKey) => {
      const entry = byDay.get(dayKey);
      return {
        dayKey,
        total: entry?.total ?? 0,
        done: entry?.done ?? 0,
      };
    });

    return NextResponse.json({
      start,
      days,
    });
  } catch (error) {
    console.error("GET /api/week-stats failed", error);
    return NextResponse.json({ error: "Failed to load week stats." }, { status: 500 });
  }
}
