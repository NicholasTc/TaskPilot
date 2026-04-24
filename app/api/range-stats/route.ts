import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TaskModel } from "@/models/Task";

const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const oneDayMs = 24 * 60 * 60 * 1000;
// Cap to prevent absurdly large scans; 70 days comfortably covers a 6-week grid.
const maxRangeDays = 70;

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function toDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, dayCount: number) {
  return new Date(date.getTime() + oneDayMs * dayCount);
}

/**
 * GET /api/range-stats?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns per-day task aggregates ({ dayKey, total, done }) for the inclusive
 * range [start, end]. Used by the homepage mini-calendar to show a progress
 * fill per day without fetching the full task list.
 *
 * `start` and `end` must be valid day keys with end >= start, and the range
 * must be <= maxRangeDays days (defensive cap).
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const start = request.nextUrl.searchParams.get("start");
    const end = request.nextUrl.searchParams.get("end");

    if (!start || !dayKeyPattern.test(start) || !end || !dayKeyPattern.test(end)) {
      return NextResponse.json(
        { error: "Missing or invalid start/end query parameter. Expected YYYY-MM-DD." },
        { status: 400 },
      );
    }

    const startDate = new Date(`${start}T00:00:00.000Z`);
    const endDate = new Date(`${end}T00:00:00.000Z`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return NextResponse.json({ error: "Invalid start or end date." }, { status: 400 });
    }

    const rawSpan = Math.round((endDate.getTime() - startDate.getTime()) / oneDayMs);
    if (rawSpan < 0) {
      return NextResponse.json({ error: "end must be on or after start." }, { status: 400 });
    }
    if (rawSpan + 1 > maxRangeDays) {
      return NextResponse.json(
        { error: `Range too large (max ${maxRangeDays} days).` },
        { status: 400 },
      );
    }

    const dayKeys = Array.from({ length: rawSpan + 1 }, (_, index) =>
      toDayKey(addDays(startDate, index)),
    );

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

    return NextResponse.json({ start, end, days });
  } catch (error) {
    console.error("GET /api/range-stats failed", error);
    return NextResponse.json({ error: "Failed to load range stats." }, { status: 500 });
  }
}
